#!/usr/bin/env python3
"""Extract the card TMP font/material selection without collapsing language or text-type variants."""

import argparse
import glob
import hashlib
import json
import os
import sys
import warnings

import UnityPy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DECRYPTED_ROOT = (
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
DEFAULT_UNITY_VERSION = "2022.3.62f2"
DEFAULT_OUTPUT = os.path.join(ROOT, "public", "render", "card-font-contract.json")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        default=os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT),
    )
    parser.add_argument(
        "--unity-version",
        default=os.environ.get("PCR_UNITY_VERSION", DEFAULT_UNITY_VERSION),
    )
    parser.add_argument("--out", default=DEFAULT_OUTPUT)
    parser.add_argument("--stdout", action="store_true")
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


ARGS = parse_args()
UnityPy.config.FALLBACK_UNITY_VERSION = ARGS.unity_version
warnings.filterwarnings("ignore")

DEC = ARGS.decrypted_root
FONT_BUNDLE = os.path.join(DEC, "Common", "Font_bundles")
PRESET_DIR = os.path.join(DEC, "Common", "CardNew", "Common", "UI", "Settings", "Font")
GROUP_DIR = os.path.join(DEC, "Common", "CardNew", "Template", "L", "Settings", "FontGroupSettings")
OUT = ARGS.out

# LanguageType values used by CardTextFontSettings. European languages use the default condition.
LOCALE_LANGUAGE = {
    "zh_TW": 7,
    "ja_JP": 0,
    "ko_KR": 6,
    "en_US": None,
    "de_DE": None,
    "fr_FR": None,
    "it_IT": None,
    "es_ES": None,
    "pt_BR": None,
}
TEXT_TYPES = {"Default": 1, "Bold": 2, "Region": 3, "MultiLine": 4}
INLINE_ELEMENT_FONT_NAME = "Pokesymbol2-regular-SDF"
INLINE_ELEMENT_MATERIAL_NAMES = {
    "Black": "Pokesymbol2-regular Atlas Material",
    "White": "Pokesymbol2-regular-SDF-White",
    "BlackWithWhiteOutline": "Pokesymbol2-regular-SDF-WhiteOutline",
}
INLINE_ELEMENT_GLYPHS = {
    "Dragon": "\ue005", "Water": "\ue007", "Grass": "\ue008",
    "Fire": "\ue009", "Fairy": "\ue00a", "Lightning": "\ue00b",
    "Psychic": "\ue00c", "Fighting": "\ue00d", "Colorless": "\ue00e",
    "Darkness": "\ue00f", "Metal": "\ue010",
}


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def stable_json_sha256(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def props_as_dict(values):
    return {entry[0]: entry[1] for entry in values}


font_env = UnityPy.load(FONT_BUNDLE)
font_objects = {obj.path_id: obj for obj in font_env.objects}
materials = {}
fonts = {}
for obj in font_env.objects:
    if obj.type.name not in ("Material", "MonoBehaviour"):
        continue
    try:
        data = obj.read_typetree()
    except Exception:
        continue
    if obj.type.name == "Material":
        saved = data.get("m_SavedProperties", {})
        materials[obj.path_id] = {
            "name": data.get("m_Name"),
            "floats": props_as_dict(saved.get("m_Floats", [])),
            "colors": props_as_dict(saved.get("m_Colors", [])),
        }
    elif "m_FaceInfo" in data and "m_AtlasTextures" in data:
        face = data.get("m_FaceInfo", {})
        source_path_id = data.get("m_SourceFontFile", {}).get("m_PathID")
        source_obj = font_objects.get(source_path_id)
        source = None
        if source_obj and source_obj.type.name == "Font":
            source_data = source_obj.read()
            font_bytes = bytes(source_data.m_FontData)
            source = {
                "pathId": str(source_path_id),
                "name": source_data.m_Name,
                "byteSize": len(font_bytes),
                "sha256": sha256(font_bytes),
            }
        atlases = []
        for pointer in data.get("m_AtlasTextures", []):
            atlas_path_id = pointer.get("m_PathID")
            atlas_obj = font_objects.get(atlas_path_id)
            if not atlas_obj or atlas_obj.type.name != "Texture2D":
                continue
            atlas = atlas_obj.read()
            payload = bytes(atlas.image_data)
            atlases.append({
                "pathId": str(atlas_path_id),
                "name": atlas.m_Name,
                "width": atlas.m_Width,
                "height": atlas.m_Height,
                "textureFormat": atlas.m_TextureFormat,
                "mipCount": atlas.m_MipCount,
                "payloadByteSize": len(payload),
                "payloadSha256": sha256(payload),
                "objectSha256": sha256(bytes(atlas_obj.get_raw_data())),
            })
        glyph_table = data.get("m_GlyphTable", [])
        character_table = data.get("m_CharacterTable", [])
        fonts[obj.path_id] = {
            "pathId": str(obj.path_id),
            "name": data.get("m_Name"),
            "family": face.get("m_FamilyName"),
            "style": face.get("m_StyleName"),
            "pointSize": face.get("m_PointSize"),
            "lineHeight": face.get("m_LineHeight"),
            "ascentLine": face.get("m_AscentLine"),
            "descentLine": face.get("m_DescentLine"),
            "atlasWidth": data.get("m_AtlasWidth"),
            "atlasHeight": data.get("m_AtlasHeight"),
            "atlasPadding": data.get("m_AtlasPadding"),
            "atlasRenderMode": data.get("m_AtlasRenderMode"),
            "atlasPopulationMode": data.get("m_AtlasPopulationMode"),
            "isMultiAtlasTexturesEnabled": bool(data.get("m_IsMultiAtlasTexturesEnabled")),
            "clearDynamicDataOnBuild": bool(data.get("m_ClearDynamicDataOnBuild")),
            "sourceFontFileGuid": data.get("m_SourceFontFileGUID"),
            "source": source,
            "atlases": atlases,
            "creationSettings": data.get("m_CreationSettings"),
            "preloadedGlyphCount": len(glyph_table),
            "preloadedCharacterCount": len(character_table),
            "preloadedGlyphTableSha256": stable_json_sha256(glyph_table),
            "preloadedCharacterTableSha256": stable_json_sha256(character_table),
            "normalStyle": data.get("normalStyle"),
            "normalSpacingOffset": data.get("normalSpacingOffset"),
            "boldStyle": data.get("boldStyle"),
            "boldSpacing": data.get("boldSpacing"),
            "italicStyle": data.get("italicStyle"),
            "tabSize": data.get("tabSize"),
        }

preset_names = {}
preset_objects = {}
for path in glob.glob(os.path.join(PRESET_DIR, "*.asset_bundles")):
    env = UnityPy.load(path)
    source_name = None
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        data = obj.read_typetree()
        name = data.get("m_Name")
        if not name:
            continue
        source_name = os.path.basename(obj.assets_file.name)
        preset_names.setdefault(source_name, {})[obj.path_id] = name
        if "_textTypeFontConditions" in data:
            preset_objects[name] = data


def select_condition(preset_name, locale, text_type):
    preset = preset_objects.get(preset_name)
    if not preset:
        return None
    text_type = next(
        (item for item in preset.get("_textTypeFontConditions", []) if item.get("_type") == text_type),
        None,
    )
    if not text_type:
        return None
    conditions = text_type.get("_conditions", [])
    language = LOCALE_LANGUAGE[locale]
    selected = None
    if language is not None:
        selected = next(
            (item for item in conditions if not item.get("_isDefault") and item.get("_language") == language),
            None,
        )
    if selected is None:
        selected = next((item for item in conditions if item.get("_isDefault")), None)
    return selected


used_font_ids = set()
used_material_ids = set()


def material_contract(material_id):
    material = materials.get(material_id, {})
    floats = material.get("floats", {})
    colors = material.get("colors", {})
    return {
        "pathId": str(material_id),
        "name": material.get("name"),
        "gradientScale": floats.get("_GradientScale"),
        "faceDilate": floats.get("_FaceDilate"),
        "outlineWidth": floats.get("_OutlineWidth", 0.0) or 0.0,
        "outlineSoftness": floats.get("_OutlineSoftness"),
        "scaleRatioA": floats.get("_ScaleRatioA"),
        "weightNormal": floats.get("_WeightNormal"),
        "weightBold": floats.get("_WeightBold"),
        "textureWidth": floats.get("_TextureWidth"),
        "textureHeight": floats.get("_TextureHeight"),
        "perspectiveFilter": floats.get("_PerspectiveFilter"),
        "sharpness": floats.get("_Sharpness"),
        "faceColor": colors.get("_FaceColor"),
        "outlineColor": colors.get("_OutlineColor"),
    }


def style_for(preset_name, locale, text_type_name, text_type):
    condition = select_condition(preset_name, locale, text_type)
    if not condition:
        return None
    pair = condition.get("_font", {})
    font_id = pair.get("_font", {}).get("m_PathID")
    material_id = pair.get("_material", {}).get("m_PathID")
    used_font_ids.add(font_id)
    used_material_ids.add(material_id)
    material = materials.get(material_id, {})
    floats = material.get("floats", {})
    colors = material.get("colors", {})
    width = floats.get("_OutlineWidth", 0.0) or 0.0
    outline_color = colors.get("_OutlineColor")
    outline = None
    if width > 0 and outline_color:
        outline = {
            "width": width,
            "color": [
                outline_color.get("r", 0.0),
                outline_color.get("g", 0.0),
                outline_color.get("b", 0.0),
                outline_color.get("a", 0.0),
            ],
        }
    return {
        "preset": preset_name,
        "cardTextType": text_type_name,
        "cardTextTypeValue": text_type,
        "fontId": str(font_id),
        "materialId": str(material_id),
        "outline": outline,
    }


groups = {}
for path in sorted(glob.glob(os.path.join(GROUP_DIR, "*.asset_bundles"))):
    env = UnityPy.load(path)
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        data = obj.read_typetree()
        if "_fonts" not in data:
            continue
        externals = list(obj.assets_file.externals)
        key_presets = {}
        for entry in data["_fonts"]:
            pointer = entry.get("_font", {})
            file_id = pointer.get("m_FileID", 0)
            path_id = pointer.get("m_PathID", 0)
            source = None
            if 1 <= file_id <= len(externals):
                source = os.path.basename(externals[file_id - 1].path)
            preset = preset_names.get(source, {}).get(path_id)
            key_presets[str(entry.get("_key"))] = preset
        groups[data.get("m_Name")] = key_presets

result = {
    "schemaVersion": 2,
    "source": "official Common/Font_bundles + CardTextFontSettings + FontGroupSettings",
    "cardTextTypes": TEXT_TYPES,
    "groups": groups,
    "locales": {},
}
for locale in LOCALE_LANGUAGE:
    used_presets = sorted({preset for keymap in groups.values() for preset in keymap.values() if preset})
    locale_presets = {}
    for preset in used_presets:
        types = {
            name: style
            for name, value in TEXT_TYPES.items()
            if (style := style_for(preset, locale, name, value)) is not None
        }
        default = types.get("Default")
        locale_presets[preset] = {**(default or {
            "preset": preset,
            "cardTextType": "Default",
            "cardTextTypeValue": TEXT_TYPES["Default"],
            "fontId": None,
            "materialId": None,
            "outline": None,
        }), "types": types}
    result["locales"][locale] = {
        "presets": locale_presets,
    }

inline_font_id = next(
    font_id for font_id, font in fonts.items()
    if font.get("name") == INLINE_ELEMENT_FONT_NAME
)
inline_material_ids = {
    kind: next(
        material_id for material_id, material in materials.items()
        if material.get("name") == material_name
    )
    for kind, material_name in INLINE_ELEMENT_MATERIAL_NAMES.items()
}
used_font_ids.add(inline_font_id)
used_material_ids.update(inline_material_ids.values())
result["inlineElements"] = {
    "producer": "LtUIImgTagCommand.PreProcessElement",
    "producerRva": "0x464e9a4",
    "defaultFontSize": 23,
    "fontId": str(inline_font_id),
    "materialIds": {kind: str(value) for kind, value in inline_material_ids.items()},
    "glyphs": INLINE_ELEMENT_GLYPHS,
}

result["fonts"] = {
    str(font_id): fonts[font_id]
    for font_id in sorted(used_font_ids)
    if font_id in fonts
}
result["materials"] = {
    str(material_id): material_contract(material_id)
    for material_id in sorted(used_material_ids)
    if material_id in materials
}

encoded = json.dumps(result, ensure_ascii=False, indent=1) + "\n"
if ARGS.stdout:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(encoded)
elif ARGS.check:
    current = open(OUT, "r", encoding="utf-8").read() if os.path.exists(OUT) else ""
    if current != encoded:
        raise SystemExit("public/render/card-font-contract.json is stale")
    print("Official card font contract OK")
else:
    with open(OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(encoded)
    print(f"wrote {OUT}: {len(LOCALE_LANGUAGE)} locales, {len(groups)} font groups")
