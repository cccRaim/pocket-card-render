#!/usr/bin/env python3
"""Build browser-readable TMP atlas assets from the official Font bundle.

Outputs live under public/game and remain BYO-data/gitignored. The manifest
keeps official FontAsset object identities, glyph tables, character maps, and
atlas payload hashes; PNG alpha is the original Alpha8 payload byte-for-byte.
"""

from __future__ import annotations

from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import sys
import warnings
import tempfile

import freetype
from PIL import Image
import UnityPy

from audit_official_tmp_atlas_pixels import (
    EXPECTED_GAME_SHA256,
    GAME_LIBUNITY,
    LOAD_FLAGS,
    NativeSdfAa,
)


ROOT = Path(__file__).resolve().parents[1]
DECRYPTED = Path(
    os.environ.get(
        "PCR_DECRYPTED_ROOT",
        "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
    )
)
FONT_BUNDLE = DECRYPTED / "Common" / "Font_bundles"
CONTRACT = ROOT / "public" / "render" / "card-font-contract.json"
CANONICAL_CORPUS = ROOT / "build" / "canonical-corpus.json"
OUTPUT = ROOT / "public" / "game" / "tmp-fonts"

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atlas_png(alpha: bytes, width: int, height: int) -> bytes:
    if len(alpha) != width * height:
        raise RuntimeError("TMP atlas is not an uncompressed Alpha8 payload")
    rgba = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    rgba.putalpha(Image.frombytes("L", (width, height), alpha))
    output = BytesIO()
    rgba.save(output, format="PNG", compress_level=9, optimize=False)
    return output.getvalue()


def required_codepoints() -> dict[str, set[int]]:
    required: dict[str, set[int]] = {}

    def is_layout_control(character: str) -> bool:
        codepoint = ord(character)
        return codepoint in range(1, 8) or codepoint in range(0xE101, 0xE10B)

    def add(font_id, text: str) -> None:
        if not font_id:
            return
        bucket = required.setdefault(str(font_id), set())
        bucket.update(ord(character) for character in text
                      if character not in "\r\n" and not is_layout_control(character))

    corpus = json.loads(CANONICAL_CORPUS.read_text(encoding="utf-8"))
    if corpus.get("schemaVersion") != 1:
        raise RuntimeError("unsupported canonical corpus schema")
    filenames = [
        ROOT / "public" / "text" / f"{scene['textStem']}.{locale}.json"
        for scene in corpus["scenes"]
        for locale in corpus["locales"]
    ]
    for filename in filenames:
        data = json.loads(filename.read_text(encoding="utf-8"))
        for element in data.get("elements", []):
            if element.get("kind") == "hp":
                add(element.get("numSdf", {}).get("fontId"), element.get("num", ""))
                add(element.get("labelSdf", {}).get("fontId"), element.get("label", ""))
                continue
            if element.get("kind") != "text":
                continue
            normal_id = element.get("sdf", {}).get("fontId")
            bold_id = element.get("boldStyle", {}).get("fontId") or normal_id
            bold = False
            for character in element.get("text", ""):
                if character == "\x01":
                    bold = True
                elif character == "\x02":
                    bold = False
                elif character not in "\r\n" and not is_layout_control(character):
                    add(bold_id if bold else normal_id, character)
    return required


def optional_fallback_codepoints() -> set[int]:
    # TMP 3.0.6's UGUI missing-glyph branch tries the configured replacement
    # (zero means U+25A1), then space, then ETX. A source font is allowed to
    # omit any candidate, so these probes must not turn into required glyphs.
    return {0x25A1, 0x20, 0x03}


def freetype_metrics(metrics) -> dict:
    return {
        "width": metrics.width / 64,
        "height": metrics.height / 64,
        "horizontalBearingX": metrics.horiBearingX / 64,
        "horizontalBearingY": metrics.horiBearingY / 64,
        "horizontalAdvance": metrics.horiAdvance / 64,
    }


def pack_runtime_glyphs(font_id: str, glyphs: list[dict], atlas_size: int = 1024) -> tuple[list[dict], dict[str, bytes]]:
    pages: list[Image.Image] = []
    page_rows: list[dict] = []
    x = y = row_height = 0
    for glyph in sorted(glyphs, key=lambda item: (-item["paddedHeight"], item["glyphIndex"])):
        width = glyph["paddedWidth"]
        height = glyph["paddedHeight"]
        if width > atlas_size or height > atlas_size:
            raise RuntimeError(f"font={font_id} glyph={glyph['glyphIndex']} exceeds runtime atlas")
        if not pages or x + width > atlas_size:
            if pages and y + row_height + height <= atlas_size:
                x = 0
                y += row_height
                row_height = 0
            else:
                pages.append(Image.new("L", (atlas_size, atlas_size), 0))
                x = y = row_height = 0
        if y + height > atlas_size:
            pages.append(Image.new("L", (atlas_size, atlas_size), 0))
            x = y = row_height = 0
        pages[-1].paste(Image.frombytes("L", (width, height), glyph["alpha"]), (x, y))
        raw_y = atlas_size - (y + height)
        page_rows.append(
            {
                "glyphIndex": glyph["glyphIndex"],
                "page": len(pages) - 1,
                "paddedRect": {"x": x, "y": raw_y, "width": width, "height": height},
                "rect": {
                    "x": x + glyph["padding"],
                    "y": raw_y + glyph["padding"],
                    "width": glyph["width"],
                    "height": glyph["height"],
                },
                "metrics": glyph["metrics"],
                "scale": 1.0,
            }
        )
        x += width
        row_height = max(row_height, height)

    files = {}
    atlases = []
    for index, alpha_image in enumerate(pages):
        alpha = alpha_image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes()
        rgba = Image.new("RGBA", alpha_image.size, (255, 255, 255, 0))
        rgba.putalpha(alpha_image)
        output = BytesIO()
        rgba.save(output, format="PNG", compress_level=9, optimize=False)
        encoded = output.getvalue()
        filename = f"{font_id}.runtime.{index}.png"
        alpha_filename = f"{font_id}.runtime.{index}.alpha.bin"
        files[filename] = encoded
        files[alpha_filename] = alpha
        atlases.append(
            {
                "index": index,
                "width": atlas_size,
                "height": atlas_size,
                "coordinateOrigin": "bottom-left",
                "url": f"/game/tmp-fonts/{filename}",
                "alphaUrl": f"/game/tmp-fonts/{alpha_filename}",
                "alphaPayloadByteSize": len(alpha),
                "alphaPayloadSha256": sha256(alpha),
                "pngByteSize": len(encoded),
                "pngSha256": sha256(encoded),
            }
        )
    return [{"atlases": atlases, "glyphs": page_rows}], files


def glyph_row(glyph: dict) -> dict:
    metrics = glyph["m_Metrics"]
    rect = glyph["m_GlyphRect"]
    return {
        "index": int(glyph["m_Index"]),
        "metrics": {
            "width": metrics["m_Width"],
            "height": metrics["m_Height"],
            "horizontalBearingX": metrics["m_HorizontalBearingX"],
            "horizontalBearingY": metrics["m_HorizontalBearingY"],
            "horizontalAdvance": metrics["m_HorizontalAdvance"],
        },
        "rect": {
            "x": int(rect["m_X"]),
            "y": int(rect["m_Y"]),
            "width": int(rect["m_Width"]),
            "height": int(rect["m_Height"]),
        },
        "scale": glyph["m_Scale"],
        "atlasIndex": int(glyph.get("m_AtlasIndex", 0)),
        "classDefinitionType": int(glyph.get("m_ClassDefinitionType", 0)),
    }


def face_row(face: dict) -> dict:
    fields = {
        "familyName": "m_FamilyName",
        "styleName": "m_StyleName",
        "pointSize": "m_PointSize",
        "scale": "m_Scale",
        "lineHeight": "m_LineHeight",
        "ascentLine": "m_AscentLine",
        "capLine": "m_CapLine",
        "meanLine": "m_MeanLine",
        "baseline": "m_Baseline",
        "descentLine": "m_DescentLine",
        "superscriptOffset": "m_SuperscriptOffset",
        "superscriptSize": "m_SuperscriptSize",
        "subscriptOffset": "m_SubscriptOffset",
        "subscriptSize": "m_SubscriptSize",
        "underlineOffset": "m_UnderlineOffset",
        "underlineThickness": "m_UnderlineThickness",
        "strikethroughOffset": "m_StrikethroughOffset",
        "strikethroughThickness": "m_StrikethroughThickness",
        "tabWidth": "m_TabWidth",
    }
    return {name: face.get(source) for name, source in fields.items()}


def build() -> tuple[dict, dict[str, bytes]]:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    environment = UnityPy.load(str(FONT_BUNDLE))
    objects = {obj.path_id: obj for obj in environment.objects}
    files = {}
    fonts = {}
    required = required_codepoints()
    game_bytes = GAME_LIBUNITY.read_bytes()
    if sha256(game_bytes) != EXPECTED_GAME_SHA256:
        raise RuntimeError("official game libunity hash drifted")
    sdf = NativeSdfAa(game_bytes)

    for font_id in sorted(contract["fonts"], key=int):
        obj = objects.get(int(font_id))
        if obj is None or obj.type.name != "MonoBehaviour":
            raise RuntimeError(f"official FontAsset {font_id} is absent")
        data = obj.read_typetree()
        source_pointer = int(data["m_SourceFontFile"]["m_PathID"])
        source_object = objects.get(source_pointer)
        source_obj = source_object.read() if source_object is not None else None
        source_bytes = bytes(source_obj.m_FontData) if source_obj is not None else b""
        expected_source = contract["fonts"][font_id]["source"]
        if expected_source is not None and sha256(source_bytes) != expected_source["sha256"]:
            raise RuntimeError(f"FontAsset {font_id} source OTF hash drifted")

        atlases = []
        for atlas_index, pointer in enumerate(data["m_AtlasTextures"]):
            atlas_obj = objects[pointer["m_PathID"]]
            atlas = atlas_obj.read()
            atlas_tree = atlas_obj.read_typetree()
            alpha = bytes(atlas.image_data)
            width = int(atlas.m_Width)
            height = int(atlas.m_Height)
            filename = f"{font_id}.{atlas_index}.png"
            alpha_filename = f"{font_id}.{atlas_index}.alpha.bin"
            encoded = atlas_png(alpha, width, height)
            files[filename] = encoded
            files[alpha_filename] = alpha
            atlases.append(
                {
                    "index": atlas_index,
                    "pathId": str(pointer["m_PathID"]),
                    "name": atlas.m_Name,
                    "width": width,
                    "height": height,
                    "textureFormat": int(atlas.m_TextureFormat),
                    "sampler": atlas_tree.get("m_TextureSettings", {}),
                    "colorSpace": atlas_tree.get("m_ColorSpace"),
                    "alphaPayloadByteSize": len(alpha),
                    "alphaPayloadSha256": sha256(alpha),
                    "objectSha256": sha256(bytes(atlas_obj.get_raw_data())),
                    "url": f"/game/tmp-fonts/{filename}",
                    "alphaUrl": f"/game/tmp-fonts/{alpha_filename}",
                    "pngByteSize": len(encoded),
                    "pngSha256": sha256(encoded),
                }
            )

        glyphs = [glyph_row(glyph) for glyph in data.get("m_GlyphTable", [])]
        characters = [
            {
                "unicode": int(character["m_Unicode"]),
                "glyphIndex": int(character["m_GlyphIndex"]),
                "scale": character.get("m_Scale", 1.0),
            }
            for character in data.get("m_CharacterTable", [])
        ]
        known_codepoints = {character["unicode"] for character in characters}
        required_for_font = required.get(font_id, set())
        candidate_codepoints = required_for_font | optional_fallback_codepoints()
        missing_codepoints = sorted(candidate_codepoints - known_codepoints)
        runtime_characters = []
        runtime_glyph_inputs = {}
        if missing_codepoints:
            if not source_bytes:
                required_missing = required_for_font - known_codepoints
                if required_missing:
                    raise RuntimeError(f"static FontAsset {font_id} lacks required preloaded glyphs")
                missing_codepoints = []
        if missing_codepoints:
            with tempfile.NamedTemporaryFile(suffix=".otf", delete=False) as handle:
                handle.write(source_bytes)
                source_name = handle.name
            try:
                face = freetype.Face(source_name)
                face.set_pixel_sizes(0, round(data["m_FaceInfo"]["m_PointSize"]))
                for codepoint in missing_codepoints:
                    glyph_index = int(face.get_char_index(codepoint))
                    if glyph_index == 0:
                        if codepoint in required_for_font:
                            raise RuntimeError(f"FontAsset {font_id} has no source glyph for U+{codepoint:04X}")
                        continue
                    face.load_glyph(glyph_index, LOAD_FLAGS)
                    bitmap = face.glyph.bitmap
                    runtime_characters.append({"unicode": codepoint, "glyphIndex": glyph_index, "scale": 1.0})
                    if glyph_index in runtime_glyph_inputs:
                        continue
                    metrics = freetype_metrics(face.glyph.metrics)
                    if bitmap.width and bitmap.rows:
                        if bitmap.pitch != bitmap.width or bitmap.pixel_mode != freetype.FT_PIXEL_MODE_GRAY:
                            raise RuntimeError(f"font={font_id} glyph={glyph_index}: unsupported FT bitmap")
                        alpha = sdf.render(bytes(bitmap.buffer), bitmap.width, bitmap.rows, int(data["m_AtlasPadding"]))
                    else:
                        alpha = b""
                    runtime_glyph_inputs[glyph_index] = {
                        "glyphIndex": glyph_index,
                        "width": int(bitmap.width),
                        "height": int(bitmap.rows),
                        "padding": int(data["m_AtlasPadding"]),
                        "paddedWidth": int(bitmap.width) + int(data["m_AtlasPadding"]) * 2,
                        "paddedHeight": int(bitmap.rows) + int(data["m_AtlasPadding"]) * 2,
                        "metrics": metrics,
                        "alpha": alpha,
                    }
            finally:
                os.unlink(source_name)

        visible_runtime_glyphs = [glyph for glyph in runtime_glyph_inputs.values() if glyph["alpha"]]
        packed, runtime_files = pack_runtime_glyphs(font_id, visible_runtime_glyphs) if visible_runtime_glyphs else ([{"atlases": [], "glyphs": []}], {})
        for runtime_atlas in packed[0]["atlases"]:
            runtime_atlas["sampler"] = atlases[0]["sampler"]
            runtime_atlas["colorSpace"] = atlases[0]["colorSpace"]
        files.update(runtime_files)
        runtime_glyph_rows = packed[0]["glyphs"]
        empty_glyphs = [
            {
                "glyphIndex": glyph["glyphIndex"],
                "page": None,
                "paddedRect": None,
                "rect": {"x": 0, "y": 0, "width": 0, "height": 0},
                "metrics": glyph["metrics"],
                "scale": 1.0,
            }
            for glyph in runtime_glyph_inputs.values()
            if not glyph["alpha"]
        ]
        fonts[font_id] = {
            "pathId": font_id,
            "name": data.get("m_Name"),
            "source": {
                "pathId": str(source_pointer),
                "name": source_obj.m_Name,
                "byteSize": len(source_bytes),
                "sha256": sha256(source_bytes),
            } if source_obj is not None else None,
            "face": face_row(data["m_FaceInfo"]),
            "atlasWidth": int(data["m_AtlasWidth"]),
            "atlasHeight": int(data["m_AtlasHeight"]),
            "atlasPadding": int(data["m_AtlasPadding"]),
            "atlasRenderMode": int(data["m_AtlasRenderMode"]),
            "atlasPopulationMode": int(data["m_AtlasPopulationMode"]),
            "normalStyle": data.get("normalStyle"),
            "normalSpacingOffset": data.get("normalSpacingOffset"),
            "boldStyle": data.get("boldStyle"),
            "boldSpacing": data.get("boldSpacing"),
            "italicStyle": data.get("italicStyle"),
            "tabSize": data.get("tabSize"),
            "fallbackFontAssetIds": [
                str(pointer.get("m_PathID"))
                for pointer in data.get("m_FallbackFontAssetTable", [])
                if pointer.get("m_PathID")
            ],
            "fontFeatureTable": data.get("m_FontFeatureTable", {}),
            "atlases": atlases,
            "glyphs": glyphs,
            "characters": characters,
            "runtimeAtlases": packed[0]["atlases"],
            "runtimeGlyphs": runtime_glyph_rows + empty_glyphs,
            "runtimeCharacters": runtime_characters,
        }

    manifest = {
        "schemaVersion": 1,
        "generatedBy": "build/build_official_tmp_atlases.py",
        "source": {
            "unityVersion": "2022.3.62f2",
            "bundle": "Common/Font_bundles",
            "bundleByteSize": FONT_BUNDLE.stat().st_size,
            "bundleSha256": sha256(FONT_BUNDLE.read_bytes()),
            "fontContract": "/render/card-font-contract.json",
        },
        "fonts": fonts,
    }
    return manifest, files


def main() -> None:
    check = "--check" in sys.argv or os.environ.get("PCR_TMP_ATLAS_CHECK") == "1"
    manifest, files = build()
    atlas_count = sum(
        len(font["atlases"]) + len(font["runtimeAtlases"])
        for font in manifest["fonts"].values()
    )
    encoded_manifest = (json.dumps(manifest, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    files["manifest.json"] = encoded_manifest
    if check:
        mismatches = []
        for filename, expected in files.items():
            path = OUTPUT / filename
            if not path.exists() or path.read_bytes() != expected:
                mismatches.append(filename)
        if mismatches:
            raise SystemExit(f"official TMP atlas assets are stale: {', '.join(mismatches)}")
        print(f"Official TMP atlas assets OK: {len(manifest['fonts'])} FontAssets, {atlas_count} atlases")
        return

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, data in files.items():
        (OUTPUT / filename).write_bytes(data)
    print(f"wrote {OUTPUT}: {len(manifest['fonts'])} FontAssets, {atlas_count} atlases")


if __name__ == "__main__":
    main()
