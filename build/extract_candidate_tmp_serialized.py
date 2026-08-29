#!/usr/bin/env python3
"""Extract candidate TMP settings and static font-atlas facts from serialized assets."""

from __future__ import annotations

import argparse
from collections import Counter
import gc
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import warnings
import zipfile

import UnityPy

from official_sample import load_official_sample


sys.dont_write_bytecode = True
DATA_PREFIX = "assets/bin/Data/"
FONT_BUNDLE_LOGICAL_PATH = "Common/Font_bundles"
TMP_SETTINGS_NAME = "TMP Settings"
LEADING_CHARACTERS_NAME = "LineBreaking Leading Characters"
FOLLOWING_CHARACTERS_NAME = "LineBreaking Following Characters"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--base-apk", required=True)
    parser.add_argument("--decrypted-root", required=True)
    parser.add_argument("--unity-version", required=True)
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def json_value(value: object) -> object:
    if isinstance(value, bytes):
        return {"byteLength": len(value), "sha256": sha256_bytes(value)}
    if isinstance(value, dict):
        return {
            str(key): json_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def value_sha256(value: object) -> str:
    encoded = json.dumps(
        json_value(value),
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256_bytes(encoded)


def pptr(file_id: int, path_id: int) -> dict:
    return {"fileId": file_id, "pathId": str(path_id)}


def pptr_from_tree(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    file_id = value.get("m_FileID")
    path_id = value.get("m_PathID")
    if not isinstance(file_id, int) or not isinstance(path_id, int):
        return None
    return pptr(file_id, path_id)


def object_identity(obj: object, name: str | None = None) -> dict:
    raw = bytes(obj.get_raw_data())
    return {
        "assetFile": str(obj.assets_file.name),
        "pathId": str(obj.path_id),
        "type": str(obj.type.name),
        "name": name if name is not None else object_name(obj),
        "rawByteLength": len(raw),
        "rawSha256": sha256_bytes(raw),
    }


def object_name(obj: object) -> str:
    try:
        return str(obj.peek_name())
    except Exception:
        return ""


def read_pptr(raw: bytes, offset: int) -> tuple[dict, int]:
    if offset + 12 > len(raw):
        raise ValueError(f"PPtr at 0x{offset:x} exceeds object length")
    file_id, path_id = struct.unpack_from("<iq", raw, offset)
    return pptr(file_id, path_id), offset + 12


def read_aligned_string(raw: bytes, offset: int) -> tuple[str, int]:
    if offset + 4 > len(raw):
        raise ValueError(f"string length at 0x{offset:x} exceeds object length")
    size = struct.unpack_from("<i", raw, offset)[0]
    offset += 4
    if size < 0 or offset + size > len(raw):
        raise ValueError(f"invalid string length {size} at 0x{offset - 4:x}")
    value = raw[offset:offset + size].decode("utf-8")
    offset = (offset + size + 3) & ~3
    return value, offset


def read_i32(raw: bytes, offset: int) -> tuple[int, int]:
    if offset + 4 > len(raw):
        raise ValueError(f"int32 at 0x{offset:x} exceeds object length")
    return struct.unpack_from("<i", raw, offset)[0], offset + 4


def read_u32(raw: bytes, offset: int) -> tuple[int, int]:
    if offset + 4 > len(raw):
        raise ValueError(f"uint32 at 0x{offset:x} exceeds object length")
    return struct.unpack_from("<I", raw, offset)[0], offset + 4


def read_f32(raw: bytes, offset: int) -> tuple[float, int]:
    if offset + 4 > len(raw):
        raise ValueError(f"float32 at 0x{offset:x} exceeds object length")
    return struct.unpack_from("<f", raw, offset)[0], offset + 4


def read_bool32(raw: bytes, offset: int) -> tuple[bool, int]:
    value, offset = read_i32(raw, offset)
    if value not in {0, 1}:
        raise ValueError(f"bool32 at 0x{offset - 4:x} is {value}")
    return bool(value), offset


def read_pptr_list(raw: bytes, offset: int) -> tuple[list[dict], int]:
    count, offset = read_i32(raw, offset)
    if count < 0 or count > 4096:
        raise ValueError(f"invalid PPtr list count {count}")
    result = []
    for _ in range(count):
        value, offset = read_pptr(raw, offset)
        result.append(value)
    return result, offset


def decode_candidate_tmp_settings_payload(raw: bytes) -> dict:
    """Decode the candidate Unity 6 TMP_Settings payload to strict EOF."""

    offset = 0
    asset_version, offset = read_aligned_string(raw, offset)
    text_wrapping_mode, offset = read_i32(raw, offset)
    enable_kerning, offset = read_bool32(raw, offset)
    active_font_feature_count, offset = read_i32(raw, offset)
    if active_font_feature_count < 0 or active_font_feature_count > 256:
        raise ValueError(
            f"invalid active font feature count {active_font_feature_count}"
        )
    active_font_features = []
    for _ in range(active_font_feature_count):
        tag, offset = read_u32(raw, offset)
        active_font_features.append({
            "value": tag,
            "tag": struct.pack(">I", tag).decode("ascii"),
        })
    enable_extra_padding, offset = read_bool32(raw, offset)
    enable_tint_all_sprites, offset = read_bool32(raw, offset)
    enable_parse_escape_characters, offset = read_bool32(raw, offset)
    enable_raycast_target, offset = read_bool32(raw, offset)
    get_font_features_at_runtime, offset = read_bool32(raw, offset)
    missing_glyph_character, offset = read_i32(raw, offset)
    clear_dynamic_data_on_build, offset = read_bool32(raw, offset)
    warnings_disabled, offset = read_bool32(raw, offset)
    default_font_asset, offset = read_pptr(raw, offset)
    default_font_asset_path, offset = read_aligned_string(raw, offset)
    default_font_size, offset = read_f32(raw, offset)
    default_auto_size_min_ratio, offset = read_f32(raw, offset)
    default_auto_size_max_ratio, offset = read_f32(raw, offset)
    default_text_mesh_pro_text_container_x, offset = read_f32(raw, offset)
    default_text_mesh_pro_text_container_y, offset = read_f32(raw, offset)
    default_text_mesh_pro_ui_container_x, offset = read_f32(raw, offset)
    default_text_mesh_pro_ui_container_y, offset = read_f32(raw, offset)
    auto_size_text_container, offset = read_bool32(raw, offset)
    is_text_object_scale_static, offset = read_bool32(raw, offset)
    fallback_font_assets, offset = read_pptr_list(raw, offset)
    match_material_preset, offset = read_bool32(raw, offset)
    hide_sub_text_objects, offset = read_bool32(raw, offset)
    default_sprite_asset, offset = read_pptr(raw, offset)
    default_sprite_asset_path, offset = read_aligned_string(raw, offset)
    enable_emoji_support, offset = read_bool32(raw, offset)
    missing_character_sprite_unicode, offset = read_u32(raw, offset)
    emoji_fallback_text_assets, offset = read_pptr_list(raw, offset)
    default_color_gradient_presets_path, offset = read_aligned_string(raw, offset)
    default_style_sheet, offset = read_pptr(raw, offset)
    style_sheets_resource_path, offset = read_aligned_string(raw, offset)
    leading_characters, offset = read_pptr(raw, offset)
    following_characters, offset = read_pptr(raw, offset)
    use_modern_hangul_line_breaking_rules, offset = read_bool32(raw, offset)
    if offset != len(raw):
        raise ValueError(
            f"TMP Settings payload parser stopped at {offset} of {len(raw)} bytes"
        )
    return {
        "assetVersion": asset_version,
        "textWrappingMode": text_wrapping_mode,
        "enableKerning": enable_kerning,
        "activeFontFeatures": active_font_features,
        "enableExtraPadding": enable_extra_padding,
        "enableTintAllSprites": enable_tint_all_sprites,
        "enableParseEscapeCharacters": enable_parse_escape_characters,
        "enableRaycastTarget": enable_raycast_target,
        "getFontFeaturesAtRuntime": get_font_features_at_runtime,
        "missingGlyphCharacter": missing_glyph_character,
        "clearDynamicDataOnBuild": clear_dynamic_data_on_build,
        "warningsDisabled": warnings_disabled,
        "defaultFontAssetPPtr": default_font_asset,
        "defaultFontAssetPath": default_font_asset_path,
        "defaultFontSize": default_font_size,
        "defaultAutoSizeMinRatio": default_auto_size_min_ratio,
        "defaultAutoSizeMaxRatio": default_auto_size_max_ratio,
        "defaultTextMeshProTextContainerSize": {
            "x": default_text_mesh_pro_text_container_x,
            "y": default_text_mesh_pro_text_container_y,
        },
        "defaultTextMeshProUITextContainerSize": {
            "x": default_text_mesh_pro_ui_container_x,
            "y": default_text_mesh_pro_ui_container_y,
        },
        "autoSizeTextContainer": auto_size_text_container,
        "isTextObjectScaleStatic": is_text_object_scale_static,
        "fallbackFontAssetPPtrs": fallback_font_assets,
        "matchMaterialPreset": match_material_preset,
        "hideSubTextObjects": hide_sub_text_objects,
        "defaultSpriteAssetPPtr": default_sprite_asset,
        "defaultSpriteAssetPath": default_sprite_asset_path,
        "enableEmojiSupport": enable_emoji_support,
        "missingCharacterSpriteUnicode": missing_character_sprite_unicode,
        "emojiFallbackTextAssetPPtrs": emoji_fallback_text_assets,
        "defaultColorGradientPresetsPath": default_color_gradient_presets_path,
        "defaultStyleSheetPPtr": default_style_sheet,
        "styleSheetsResourcePath": style_sheets_resource_path,
        "leadingCharactersPPtr": leading_characters,
        "followingCharactersPPtr": following_characters,
        "useModernHangulLineBreakingRules":
            use_modern_hangul_line_breaking_rules,
    }


def decode_mono_behaviour_envelope(raw: bytes) -> dict:
    game_object, offset = read_pptr(raw, 0)
    if offset + 4 > len(raw):
        raise ValueError("MonoBehaviour enabled field exceeds object length")
    enabled = raw[offset]
    padding = raw[offset + 1:offset + 4]
    if enabled not in {0, 1} or any(padding):
        raise ValueError("unexpected MonoBehaviour enabled field or padding")
    offset += 4
    script, offset = read_pptr(raw, offset)
    name, offset = read_aligned_string(raw, offset)
    payload = raw[offset:]
    return {
        "gameObject": game_object,
        "enabled": bool(enabled),
        "script": script,
        "name": name,
        "serializedPayload": {
            "offset": offset,
            "byteLength": len(payload),
            "sha256": sha256_bytes(payload),
            "hex": payload.hex(),
        },
    }


def properties_hash_bytes(value: object) -> bytes:
    if not isinstance(value, dict):
        raise ValueError("MonoScript m_PropertiesHash is not a serialized byte map")
    indexed = []
    for key, byte in value.items():
        if not isinstance(key, str) or not key.startswith("bytes["):
            raise ValueError("unexpected MonoScript properties-hash key")
        index = int(key[6:-1])
        indexed.append((index, int(byte)))
    indexed.sort()
    if [index for index, _ in indexed] != list(range(len(indexed))):
        raise ValueError("MonoScript properties-hash indices are not contiguous")
    return bytes(byte for _, byte in indexed)


def external_records(assets_file: object) -> list[dict]:
    records = []
    for file_id, external in enumerate(assets_file.externals, start=1):
        guid = external.guid
        guid_hex = guid.hex() if hasattr(guid, "hex") else str(guid)
        records.append({
            "fileId": file_id,
            "path": str(external.path).replace("\\", "/"),
            "guid": guid_hex,
            "type": int(external.type),
        })
    return records


def find_pptr_offsets(raw: bytes, target: dict, start: int) -> list[int]:
    needle = struct.pack(
        "<iq",
        int(target["fileId"]),
        int(target["pathId"]),
    )
    return [
        offset
        for offset in range(start, len(raw) - len(needle) + 1, 4)
        if raw[offset:offset + len(needle)] == needle
    ]


def text_asset_record(obj: object, expected_name: str) -> dict:
    identity = object_identity(obj, expected_name)
    raw = bytes(obj.get_raw_data())
    name, offset = read_aligned_string(raw, 0)
    if name != expected_name:
        raise ValueError(f"TextAsset name mismatch: {name!r} != {expected_name!r}")
    if offset + 4 > len(raw):
        raise ValueError(f"TextAsset {expected_name} has no script length")
    script_size = struct.unpack_from("<i", raw, offset)[0]
    offset += 4
    if script_size < 0 or offset + script_size > len(raw):
        raise ValueError(f"TextAsset {expected_name} has invalid script length")
    script_bytes = raw[offset:offset + script_size]
    offset = (offset + script_size + 3) & ~3
    if offset != len(raw):
        raise ValueError(
            f"TextAsset {expected_name} parser stopped at {offset} of {len(raw)}"
        )
    text = script_bytes.decode("utf-8-sig")
    return {
        **identity,
        "textByteLength": len(script_bytes),
        "textSha256": sha256_bytes(script_bytes),
        "characterCount": len(text),
        "text": text,
    }


def extract_apk_tmp_settings(
    base_apk: Path,
    unity_version: str,
    expected_identity: dict,
) -> dict:
    actual_size = base_apk.stat().st_size
    actual_sha256 = sha256_file(base_apk)
    if actual_size != expected_identity["byteLength"]:
        raise ValueError(
            f"base APK byte length mismatch: {actual_size} != "
            f"{expected_identity['byteLength']}"
        )
    if actual_sha256 != expected_identity["sha256"]:
        raise ValueError(
            f"base APK SHA-256 mismatch: {actual_sha256} != "
            f"{expected_identity['sha256']}"
        )

    data_entries = []
    with zipfile.ZipFile(base_apk) as archive, tempfile.TemporaryDirectory(
        ignore_cleanup_errors=True
    ) as temporary:
        data_root = Path(temporary) / "Data"
        data_root.mkdir()
        for name in sorted(archive.namelist()):
            if not name.startswith(DATA_PREFIX) or name.endswith("/"):
                continue
            relative = name[len(DATA_PREFIX):]
            payload = archive.read(name)
            target = data_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            data_entries.append({
                "path": relative.replace("\\", "/"),
                "byteLength": len(payload),
                "sha256": sha256_bytes(payload),
            })

        UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
        environment = UnityPy.load(str(data_root))
        settings_objects = [
            obj for obj in environment.objects
            if obj.type.name == "MonoBehaviour" and object_name(obj) == TMP_SETTINGS_NAME
        ]
        leading_objects = [
            obj for obj in environment.objects
            if obj.type.name == "TextAsset" and object_name(obj) == LEADING_CHARACTERS_NAME
        ]
        following_objects = [
            obj for obj in environment.objects
            if obj.type.name == "TextAsset" and object_name(obj) == FOLLOWING_CHARACTERS_NAME
        ]
        if len(settings_objects) != 1:
            raise ValueError(f"expected one TMP Settings object, found {len(settings_objects)}")
        if len(leading_objects) != 1 or len(following_objects) != 1:
            raise ValueError(
                "expected one leading and one following line-breaking TextAsset"
            )

        settings_obj = settings_objects[0]
        settings_raw = bytes(settings_obj.get_raw_data())
        envelope = decode_mono_behaviour_envelope(settings_raw)
        if envelope["name"] != TMP_SETTINGS_NAME:
            raise ValueError("TMP Settings envelope name mismatch")
        script_pointer = envelope["script"]
        script_path_id = int(script_pointer["pathId"])
        external = external_records(settings_obj.assets_file)
        script_asset = (
            external[script_pointer["fileId"] - 1]["path"]
            if 1 <= script_pointer["fileId"] <= len(external)
            else str(settings_obj.assets_file.name)
        )
        script_objects = [
            obj for obj in environment.objects
            if obj.type.name == "MonoScript"
            and obj.path_id == script_path_id
            and str(obj.assets_file.name) == script_asset
        ]
        if len(script_objects) != 1:
            raise ValueError(
                f"could not resolve TMP Settings MonoScript {script_asset}:{script_path_id}"
            )
        script_obj = script_objects[0]
        script_tree = script_obj.read_typetree()
        properties_hash = properties_hash_bytes(script_tree.get("m_PropertiesHash"))
        line_objects = [
            (LEADING_CHARACTERS_NAME, leading_objects[0]),
            (FOLLOWING_CHARACTERS_NAME, following_objects[0]),
        ]
        resolved_payload_references = []
        for target_name, target_obj in line_objects:
            matching_external = [
                item for item in external
                if item["path"] == str(target_obj.assets_file.name)
            ]
            if len(matching_external) != 1:
                raise ValueError(
                    f"could not map {target_name} to one serialized external"
                )
            target_pointer = pptr(
                matching_external[0]["fileId"],
                target_obj.path_id,
            )
            offsets = find_pptr_offsets(
                settings_raw,
                target_pointer,
                envelope["serializedPayload"]["offset"],
            )
            if len(offsets) != 1:
                raise ValueError(
                    f"expected one serialized reference to {target_name}, "
                    f"found {len(offsets)}"
                )
            resolved_payload_references.append({
                "target": target_name,
                "pointer": target_pointer,
                "objectOffset": offsets[0],
                "payloadOffset": (
                    offsets[0] - envelope["serializedPayload"]["offset"]
                ),
                "targetObject": object_identity(target_obj, target_name),
            })

        result = {
            "baseApk": {
                "logicalName": expected_identity.get("entry", base_apk.name),
                "byteLength": actual_size,
                "sha256": actual_sha256,
            },
            "unityData": {
                "entryCount": len(data_entries),
                "inventorySha256": value_sha256(data_entries),
            },
            "tmpSettings": {
                "object": object_identity(settings_obj, TMP_SETTINGS_NAME),
                "envelope": envelope,
                "externalDependencies": external,
                "monoScript": {
                    **object_identity(script_obj, str(script_tree.get("m_Name", ""))),
                    "className": script_tree.get("m_ClassName"),
                    "namespace": script_tree.get("m_Namespace"),
                    "assemblyName": script_tree.get("m_AssemblyName"),
                    "executionOrder": script_tree.get("m_ExecutionOrder"),
                    "propertiesHash": properties_hash.hex(),
                    "propertiesHashSha256": sha256_bytes(properties_hash),
                },
                "resolvedPayloadReferences": resolved_payload_references,
                "fieldLayout": {
                    "status": "partial-exact-metadata-derived",
                    "decodedEnvelope": True,
                    "decodedPayloadFields": 36,
                    "strictEof": True,
                    "managedFieldOrderSource":
                        "candidate IL2CPP metadata / TMPro.TMP_Settings",
                    "reason": (
                        "the custom TypeTree is stripped; candidate metadata supplies "
                        "the field order while raw payload bytes and PPtrs are parsed "
                        "to strict EOF"
                    ),
                },
                "settings": decode_candidate_tmp_settings_payload(
                    bytes.fromhex(envelope["serializedPayload"]["hex"])
                ),
            },
            "lineBreaking": {
                "leadingCharacters": text_asset_record(
                    leading_objects[0], LEADING_CHARACTERS_NAME
                ),
                "followingCharacters": text_asset_record(
                    following_objects[0], FOLLOWING_CHARACTERS_NAME
                ),
            },
        }
        del target_obj
        del settings_obj
        del script_obj
        del settings_objects
        del leading_objects
        del following_objects
        del script_objects
        del environment
        gc.collect()
        return result


def local_object(objects: dict[int, object], pointer: object, expected_type: str) -> object:
    normalized = pptr_from_tree(pointer)
    if normalized is None:
        raise ValueError(f"invalid {expected_type} PPtr")
    if normalized["fileId"] != 0:
        raise ValueError(f"{expected_type} PPtr is external: {normalized}")
    obj = objects.get(int(normalized["pathId"]))
    if obj is None or obj.type.name != expected_type:
        raise ValueError(f"unresolved {expected_type} PPtr: {normalized}")
    return obj


def source_font_record(objects: dict[int, object], pointer: object) -> dict | None:
    normalized = pptr_from_tree(pointer)
    if normalized is None or int(normalized["pathId"]) == 0:
        return None
    obj = local_object(objects, pointer, "Font")
    value = obj.read()
    font_data = bytes(value.m_FontData)
    return {
        **object_identity(obj, str(value.m_Name)),
        "fontDataByteLength": len(font_data),
        "fontDataSha256": sha256_bytes(font_data),
    }


def atlas_record(
    objects: dict[int, object],
    resources: dict[str, bytes],
    pointer: object,
) -> dict:
    normalized = pptr_from_tree(pointer)
    obj = local_object(objects, pointer, "Texture2D")
    tree = obj.read_typetree()
    value = obj.read()
    image_data = bytes(value.image_data)
    stream_data = tree.get("m_StreamData")
    image_payload_source = "serialized-inline"
    resource_record = None
    if not image_data and isinstance(stream_data, dict) and stream_data.get("size", 0):
        resource_name = str(stream_data.get("path", "")).rsplit("/", 1)[-1]
        resource = resources.get(resource_name)
        if resource is None:
            raise ValueError(
                f"unresolved Texture2D stream resource {resource_name!r}"
            )
        offset = int(stream_data.get("offset", 0))
        size = int(stream_data["size"])
        if offset < 0 or size < 0 or offset + size > len(resource):
            raise ValueError(
                f"Texture2D stream range {offset}+{size} exceeds "
                f"{resource_name} ({len(resource)} bytes)"
            )
        image_data = resource[offset:offset + size]
        image_payload_source = "serialized-resource"
        resource_record = {
            "name": resource_name,
            "byteLength": len(resource),
            "sha256": sha256_bytes(resource),
            "offset": offset,
            "size": size,
        }
    expected_payload_size = (
        int(stream_data["size"])
        if image_payload_source == "serialized-resource"
        else int(tree.get("m_CompleteImageSize", 0))
    )
    if len(image_data) != expected_payload_size:
        raise ValueError(
            f"Texture2D payload size mismatch for {tree.get('m_Name')}: "
            f"{len(image_data)} != {expected_payload_size}"
        )
    return {
        **object_identity(obj, str(tree.get("m_Name", ""))),
        "pointer": normalized,
        "width": tree.get("m_Width"),
        "height": tree.get("m_Height"),
        "completeImageSize": tree.get("m_CompleteImageSize"),
        "textureFormat": tree.get("m_TextureFormat"),
        "mipCount": tree.get("m_MipCount"),
        "mipsStripped": tree.get("m_MipsStripped"),
        "imageCount": tree.get("m_ImageCount"),
        "textureDimension": tree.get("m_TextureDimension"),
        "isReadable": bool(tree.get("m_IsReadable")),
        "isPreProcessed": bool(tree.get("m_IsPreProcessed")),
        "ignoreMipmapLimit": bool(tree.get("m_IgnoreMipmapLimit")),
        "streamingMipmaps": bool(tree.get("m_StreamingMipmaps")),
        "streamingMipmapsPriority": tree.get("m_StreamingMipmapsPriority"),
        "lightmapFormat": tree.get("m_LightmapFormat"),
        "colorSpace": tree.get("m_ColorSpace"),
        "textureSettings": json_value(tree.get("m_TextureSettings")),
        "streamData": json_value(stream_data),
        "imagePayloadSource": image_payload_source,
        "streamResource": resource_record,
        "imagePayloadCompleteness": "exact",
        "imagePayloadByteLength": len(image_data),
        "imagePayloadSha256": sha256_bytes(image_data),
    }


def table_record(value: object) -> dict:
    count = len(value) if isinstance(value, (list, dict)) else 0
    return {"count": count, "sha256": value_sha256(value)}


def font_asset_record(
    objects: dict[int, object],
    resources: dict[str, bytes],
    obj: object,
    tree: dict,
) -> dict:
    atlases = [
        atlas_record(objects, resources, pointer)
        for pointer in tree.get("m_AtlasTextures", [])
    ]
    face = tree.get("m_FaceInfo", {})
    return {
        **object_identity(obj, str(tree.get("m_Name", ""))),
        "script": pptr_from_tree(tree.get("m_Script")),
        "version": tree.get("m_Version"),
        "faceInfo": json_value(face),
        "atlasConfiguration": {
            "width": tree.get("m_AtlasWidth"),
            "height": tree.get("m_AtlasHeight"),
            "padding": tree.get("m_AtlasPadding"),
            "renderMode": tree.get("m_AtlasRenderMode"),
            "populationMode": tree.get("m_AtlasPopulationMode"),
            "activeTextureIndex": tree.get("m_AtlasTextureIndex"),
            "isMultiAtlasTexturesEnabled": bool(
                tree.get("m_IsMultiAtlasTexturesEnabled")
            ),
            "clearDynamicDataOnBuild": bool(tree.get("m_ClearDynamicDataOnBuild")),
            "getFontFeatures": bool(tree.get("m_GetFontFeatures")),
            "shouldReimportFontFeatures": bool(
                tree.get("m_ShouldReimportFontFeatures")
            ),
        },
        "creationSettings": json_value(tree.get("m_CreationSettings")),
        "sourceFontFileGuid": tree.get("m_SourceFontFileGUID"),
        "sourceFontFilePath": tree.get("m_SourceFontFilePath"),
        "sourceFont": source_font_record(objects, tree.get("m_SourceFontFile")),
        "atlasTextures": atlases,
        "tables": {
            "glyphs": table_record(tree.get("m_GlyphTable", [])),
            "characters": table_record(tree.get("m_CharacterTable", [])),
            "fontFeatures": table_record(tree.get("m_FontFeatureTable", {})),
            "usedGlyphRects": table_record(tree.get("m_UsedGlyphRects", [])),
            "freeGlyphRects": table_record(tree.get("m_FreeGlyphRects", [])),
            "fallbackFontAssets": table_record(
                tree.get("m_FallbackFontAssetTable", [])
            ),
            "fontWeights": table_record(tree.get("m_FontWeightTable", [])),
        },
        "serializedTables": {
            "glyphs": json_value(tree.get("m_GlyphTable", [])),
            "characters": json_value(tree.get("m_CharacterTable", [])),
            "fontFeatureTable": json_value(tree.get("m_FontFeatureTable", {})),
        },
        "fallbackFontAssetPointers": json_value(
            tree.get("m_FallbackFontAssetTable", [])
        ),
        "typography": {
            "normalStyle": tree.get("normalStyle"),
            "normalSpacingOffset": tree.get("normalSpacingOffset"),
            "boldStyle": tree.get("boldStyle"),
            "boldSpacing": tree.get("boldSpacing"),
            "italicStyle": tree.get("italicStyle"),
            "tabSize": tree.get("tabSize"),
        },
    }


def extract_font_bundle(decrypted_root: Path, unity_version: str) -> dict:
    bundle = decrypted_root / Path(FONT_BUNDLE_LOGICAL_PATH)
    if not bundle.is_file():
        raise FileNotFoundError(f"candidate font bundle does not exist: {bundle}")
    bundle_size = bundle.stat().st_size
    bundle_sha256 = sha256_file(bundle)

    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    environment = UnityPy.load(str(bundle))
    objects = {obj.path_id: obj for obj in environment.objects}
    resources = {}
    for loaded_file in environment.files.values():
        nested_files = getattr(loaded_file, "files", {})
        for name, nested in nested_files.items():
            if hasattr(nested, "bytes"):
                resources[str(name)] = bytes(nested.bytes)
    object_type_counts = Counter(obj.type.name for obj in environment.objects)
    font_assets = []
    font_asset_field_names = None
    typetree_failures = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception as error:
            typetree_failures.append({
                **object_identity(obj),
                "errorType": type(error).__name__,
            })
            continue
        if "m_FaceInfo" not in tree or "m_AtlasTextures" not in tree:
            continue
        current_names = sorted(tree)
        if font_asset_field_names is None:
            font_asset_field_names = current_names
        elif current_names != font_asset_field_names:
            raise ValueError("candidate FontAsset serialized field sets are inconsistent")
        font_assets.append(font_asset_record(objects, resources, obj, tree))

    font_assets.sort(key=lambda item: int(item["pathId"]))
    if not font_assets:
        raise ValueError("no serialized TMP FontAsset objects found")
    atlas_path_ids = [
        atlas["pathId"]
        for font in font_assets
        for atlas in font["atlasTextures"]
    ]
    if len(atlas_path_ids) != len(set(atlas_path_ids)):
        raise ValueError("serialized FontAssets share an unexpected atlas Texture2D object")
    glyph_count = sum(font["tables"]["glyphs"]["count"] for font in font_assets)
    character_count = sum(
        font["tables"]["characters"]["count"] for font in font_assets
    )
    source_fonts = [
        font["sourceFont"] for font in font_assets if font["sourceFont"] is not None
    ]
    unique_source_font_path_ids = {
        font["pathId"] for font in source_fonts
    }
    referenced_atlas_bytes = sum(
        atlas["imagePayloadByteLength"]
        for font in font_assets
        for atlas in font["atlasTextures"]
    )
    atlas_payload_source_counts = Counter(
        atlas["imagePayloadSource"]
        for font in font_assets
        for atlas in font["atlasTextures"]
    )
    result = {
        "source": {
            "logicalPath": FONT_BUNDLE_LOGICAL_PATH,
            "byteLength": bundle_size,
            "sha256": bundle_sha256,
            "serializedResources": [
                {
                    "name": name,
                    "byteLength": len(payload),
                    "sha256": sha256_bytes(payload),
                }
                for name, payload in sorted(resources.items())
            ],
        },
        "objectTypeCounts": dict(sorted(object_type_counts.items())),
        "fontAssetSerializedFieldNames": font_asset_field_names,
        "fontAssetSerializedFieldNamesSha256": value_sha256(
            font_asset_field_names
        ),
        "typetreeFailures": typetree_failures,
        "fontAssets": font_assets,
        "summary": {
            "fontAssetCount": len(font_assets),
            "sourceFontReferenceCount": len(source_fonts),
            "referencedSourceFontObjectCount": len(unique_source_font_path_ids),
            "sourceFontObjectCount": object_type_counts.get("Font", 0),
            "unreferencedSourceFontObjectCount": (
                object_type_counts.get("Font", 0) - len(unique_source_font_path_ids)
            ),
            "atlasTextureCount": len(atlas_path_ids),
            "atlasTextureObjectCount": object_type_counts.get("Texture2D", 0),
            "unreferencedTextureObjectCount": (
                object_type_counts.get("Texture2D", 0) - len(atlas_path_ids)
            ),
            "glyphCount": glyph_count,
            "characterCount": character_count,
            "referencedAtlasPayloadByteLength": referenced_atlas_bytes,
            "atlasPayloadSourceCounts": dict(
                sorted(atlas_payload_source_counts.items())
            ),
            "fontAssetTypetreeFailureCount": 0,
            "otherMonoBehaviourTypetreeFailureCount": len(typetree_failures),
        },
    }
    del environment
    gc.collect()
    return result


def main() -> None:
    args = parse_args()
    warnings.filterwarnings("ignore")
    loaded = load_official_sample(args.candidate_manifest)
    sample = loaded["sample"]
    if sample.get("status") != "candidate":
        raise ValueError("extractor accepts candidate manifests only")
    if args.unity_version != sample["unity"]["serializedVersion"]:
        raise ValueError(
            f"Unity version mismatch: {args.unity_version} != "
            f"{sample['unity']['serializedVersion']}"
        )
    base_identity = sample["artifacts"]["baseApk"]
    if base_identity.get("status") not in {None, "resolved"}:
        raise ValueError("candidate base APK identity is unresolved")

    apk_evidence = extract_apk_tmp_settings(
        Path(args.base_apk).resolve(),
        args.unity_version,
        base_identity,
    )
    font_evidence = extract_font_bundle(
        Path(args.decrypted_root).resolve(),
        args.unity_version,
    )
    result = {
        "schema": "pocket-card-render/candidate-tmp-serialized-extract@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
        },
        "scope": {
            "status": "exact-serialized-only",
            "nativeCodeUsed": False,
            "runtimeCaptureUsed": False,
            "generatedAtlasUsed": False,
        },
        "apkSerializedSettings": apk_evidence,
        "fontBundle": font_evidence,
        "summary": {
            "tmpSettingsObjectCount": 1,
            "decodedTmpSettingsPayloadFieldCount": (
                apk_evidence["tmpSettings"]["fieldLayout"]["decodedPayloadFields"]
            ),
            "lineBreakingTextAssetCount": 2,
            **font_evidence["summary"],
        },
        "runtimeBoundaries": [
            {
                "id": "unity6-dynamic-fontengine",
                "status": "runtime-required",
                "baselineNativeSdfAaReused": False,
                "nativeSdfAaInvoked": False,
                "requiredEvidence": [
                    f"matching Unity {args.unity_version} release player and symbols",
                    "candidate native FontEngine glyph generation bodies",
                    "official guest dynamic atlas mutation and glyph mesh bindings",
                ],
                "reason": (
                    "serialized TMP settings, FontAssets, source fonts, glyph "
                    "tables, and atlas Texture2D payloads do not prove Unity 6 "
                    "dynamic FontEngine behavior"
                ),
            },
            {
                "id": "candidate-tmp-settings-field-layout",
                "status": "runtime-required",
                "requiredEvidence": [
                    "candidate runtime reads that consume the decoded TMP_Settings fields",
                    "matching Unity 6 TMP package source or symbols for behavioral semantics",
                ],
                "reason": (
                    "the candidate APK strips the custom TMP_Settings TypeTree; "
                    "candidate IL2CPP metadata supplies a strict-EOF field layout, "
                    "but serialized values alone do not prove Unity 6 runtime behavior"
                ),
            },
        ],
    }
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
