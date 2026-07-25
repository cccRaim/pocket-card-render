#!/usr/bin/env python3
"""Extract keyword-variant resource and constant-buffer bindings from a Unity shader bundle."""
import argparse
import json
import os
import struct
import sys
import warnings

import UnityPy
import lz4.block

try:
    from shaderdec.unity_parameter_entry import parse_parameter_entry
except ModuleNotFoundError:
    from unity_parameter_entry import parse_parameter_entry

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", message="No valid Unity version found.*")


def find_shader(suffix, root):
    for directory, _, files in os.walk(root):
        for filename in files:
            try:
                env = UnityPy.load(os.path.join(directory, filename))
            except Exception:
                continue
            for obj in env.objects:
                if obj.type.name != "Shader":
                    continue
                try:
                    data = obj.read_typetree()
                except Exception:
                    continue
                if data.get("m_ParsedForm", {}).get("m_Name", "").endswith(suffix):
                    return data
    return None


def u32(data, offset):
    if offset < 0 or offset + 4 > len(data):
        raise ValueError(f"u32 at {offset} exceeds {len(data)}-byte parameter entry")
    return struct.unpack_from("<I", data, offset)[0], offset + 4


def aligned_string(data, offset):
    length, offset = u32(data, offset)
    end = offset + length
    aligned_end = (end + 3) & ~3
    if end > len(data) or aligned_end > len(data):
        raise ValueError(f"aligned string at {offset - 4} exceeds parameter entry")
    value = data[offset:end].decode("utf-8")
    if any(data[end:aligned_end]):
        raise ValueError(f"aligned string {value!r} has nonzero padding")
    return value, aligned_end


def program_entries(data):
    count, _ = u32(data, 0)
    return [struct.unpack_from("<III", data, 4 + index * 12) for index in range(count)]


def decompressed_programs(shader):
    blob = bytes(shader["compressedBlob"])
    for platform_index in range(len(shader.get("platforms", []))):
        offsets = shader["offsets"][platform_index]
        lengths = shader["compressedLengths"][platform_index]
        decoded_lengths = shader["decompressedLengths"][platform_index]
        for slot_index, compressed_length in enumerate(lengths):
            offset = offsets[slot_index] if isinstance(offsets, list) else offsets
            try:
                yield lz4.block.decompress(
                    blob[offset:offset + compressed_length],
                    uncompressed_size=decoded_lengths[slot_index],
                )
            except Exception:
                continue


def select_variant(shader, keyword=None, no_keywords=False):
    parsed = shader.get("m_ParsedForm", {})
    keyword_names = parsed.get("m_KeywordNames", [])
    if keyword and keyword not in keyword_names:
        raise ValueError(f"keyword {keyword!r} not found")
    keyword_index = keyword_names.index(keyword) if keyword else None
    candidates = []
    for subshader in parsed.get("m_SubShaders", []):
        for shader_pass in subshader.get("m_Passes", []):
            for stage_name in ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain"):
                stage = shader_pass.get(stage_name, {})
                player_groups = stage.get("m_PlayerSubPrograms", [])
                parameter_groups = stage.get("m_ParameterBlobIndices", [])
                for group_index, players in enumerate(player_groups):
                    for variant_index, player in enumerate(players or []):
                        indices = player.get("m_KeywordIndices", [])
                        if keyword and keyword_index not in indices:
                            continue
                        if no_keywords and indices:
                            continue
                        parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
                        if variant_index >= len(parameters):
                            raise ValueError("selected variant has no parameter blob index")
                        candidates.append((shader_pass, stage, player, variant_index, parameters[variant_index]))
    if len(candidates) != 1:
        selector = f"keyword {keyword!r}" if keyword else "empty keyword set"
        raise ValueError(f"{selector} matched {len(candidates)} variants")
    shader_pass, stage, player, variant_index, parameter_blob_index = candidates[0]
    selected_keywords = [keyword_names[index] for index in player.get("m_KeywordIndices", [])]
    return {
        "pass": shader_pass,
        "stage": stage,
        "player": player,
        "variantIndex": variant_index,
        "parameterBlobIndex": parameter_blob_index,
        "programBlobIndex": player.get("m_BlobIndex"),
        "selectedKeywords": selected_keywords,
    }


def parse_parameter_blob(data, texture_names):
    return parse_parameter_entry(data, texture_names)


def common_textures(shader_pass):
    names = {index: name for name, index in shader_pass.get("m_NameIndices", [])}
    textures = {}
    for stage_name in ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain"):
        common = shader_pass.get(stage_name, {}).get("m_CommonParameters", {})
        for item in common.get("m_TextureParams", []):
            name = names.get(item.get("m_NameIndex"))
            if name:
                textures[name] = {
                    "name": name,
                    "binding": int(item.get("m_Index", 0)) & 0xFFFFFF,
                    "encodedIndex": int(item.get("m_Index", 0)),
                    "dim": item.get("m_Dim"),
                    "source": "common",
                }
    return list(textures.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("suffix")
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--keyword")
    selector.add_argument("--no-keywords", action="store_true")
    parser.add_argument("--shaders", default=os.environ.get("PCR_SHADERS", "decrypted/Common/Shader"))
    args = parser.parse_args()

    shader = find_shader(args.suffix, args.shaders)
    if not shader:
        raise SystemExit(f"shader {args.suffix!r} not found")
    selected = select_variant(shader, args.keyword, args.no_keywords)
    max_index = max(selected["parameterBlobIndex"], selected["programBlobIndex"])
    decoded = None
    entries = None
    for candidate in decompressed_programs(shader):
        candidate_entries = program_entries(candidate)
        if max_index < len(candidate_entries):
            decoded = candidate
            entries = candidate_entries
            break
    if decoded is None:
        raise SystemExit("selected program blobs were not found")

    blob_offset, blob_length, _ = entries[selected["parameterBlobIndex"]]
    parameter_data = decoded[blob_offset:blob_offset + blob_length]
    props = shader.get("m_ParsedForm", {}).get("m_PropInfo", {}).get("m_Props", [])
    texture_names = {prop.get("m_Name") for prop in props if prop.get("m_Type") == 4}
    parsed_blob = parse_parameter_blob(parameter_data, texture_names)
    merged_textures = {item["name"]: item for item in common_textures(selected["pass"])}
    for item in parsed_blob["textures"]:
        item["source"] = "variant"
        if item["name"] in merged_textures:
            raise SystemExit(f"duplicate texture binding for {item['name']}")
        merged_textures[item["name"]] = item

    result = {
        "shader": shader["m_ParsedForm"]["m_Name"],
        "keyword": args.keyword,
        "selectedKeywords": selected["selectedKeywords"],
        "variantIndex": selected["variantIndex"],
        "parameterBlobIndex": selected["parameterBlobIndex"],
        "programBlobIndex": selected["programBlobIndex"],
        "textures": sorted(merged_textures.values(), key=lambda item: item["binding"]),
        "constantBuffers": parsed_blob["constantBuffers"],
        "constantBufferBindings": parsed_blob["constantBufferBindings"],
        "parameterBlobVersion": parsed_blob["version"],
        "parameterBlobConstantBlockCount": parsed_blob["constantBlockCount"],
        "parameterBlobResourceCount": parsed_blob["resourceCount"],
    }
    json.dump(result, sys.stdout, indent=2, sort_keys=False)


if __name__ == "__main__":
    main()
