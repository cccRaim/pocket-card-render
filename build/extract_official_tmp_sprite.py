#!/usr/bin/env python3
"""Extract TextExSprite and its native/TMP layout contract from official sources."""

from __future__ import annotations

import base64
from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import warnings

import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
UNITY_VERSION = "2022.3.62f2"
DECRYPTED = Path(os.environ.get(
    "PCR_DECRYPTED_ROOT",
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
))
FONT_BUNDLE = DECRYPTED / "Common" / "Font_bundles"
IL2CPP = Path(os.environ.get(
    "PCR_IL2CPP",
    ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "libil2cpp.so",
))
IL2CPP_OUT = Path(os.environ.get(
    "PCR_IL2CPP_DUMPER_OUT",
    ROOT.parent / "ptcg-apk-parser" / "tools" / "vendor" / "Il2CppDumper" / "out",
))
TEXT_GENERATOR = Path(os.environ.get(
    "PCR_UNITY_TEXT_GENERATOR",
    "D:/DevProjectes/_vendor/UnityCsReference-2022.3.62f2/Modules/"
    "TextCoreTextEngine/Managed/TextGenerator.cs",
))
SPRITE_ASSET_ID = 840073264968542736
MATERIAL_ID = -1050951510632854060
TEXTURE_ID = 3209478181533236899

UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pointer(value: object) -> dict:
    if not isinstance(value, dict):
        return {"fileId": 0, "pathId": "0"}
    return {
        "fileId": int(value.get("m_FileID", 0)),
        "pathId": str(int(value.get("m_PathID", 0))),
    }


def color(value: dict) -> dict:
    return {key: float(value[key]) for key in ("r", "g", "b", "a")}


class Elf64:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.data = self.path.read_bytes()
        if self.data[:6] != b"\x7fELF\x02\x01":
            raise RuntimeError(f"{path}: expected ELF64 little-endian")
        phoff = struct.unpack_from("<Q", self.data, 0x20)[0]
        entsize = struct.unpack_from("<H", self.data, 0x36)[0]
        count = struct.unpack_from("<H", self.data, 0x38)[0]
        self.loads = []
        for index in range(count):
            values = struct.unpack_from("<IIQQQQQQ", self.data, phoff + index * entsize)
            if values[0] == 1:
                self.loads.append((values[2], values[3], values[5]))

    def offset(self, rva: int) -> int:
        for offset, vaddr, file_size in self.loads:
            if vaddr <= rva < vaddr + file_size:
                return offset + rva - vaddr
        raise RuntimeError(f"RVA is not file-backed: {rva:#x}")

    def range(self, start: int, end: int) -> bytes:
        return self.data[self.offset(start):self.offset(end)]


def method_record(elf: Elf64, methods: list[dict], name: str) -> dict:
    entry = next(item for item in methods if item.get("Name") == name)
    start = int(entry["Address"])
    end = min(int(item["Address"]) for item in methods if int(item.get("Address", 0)) > start)
    body = elf.range(start, end)
    return {
        "name": name,
        "rva": f"0x{start:x}",
        "endRva": f"0x{end:x}",
        "byteSize": len(body),
        "sha256": sha256(body),
    }


def source_range(lines: list[str], start: int, end: int) -> dict:
    data = "".join(lines[start - 1:end]).encode("utf-8")
    return {"startLine": start, "endLine": end, "sha256": sha256(data)}


def extract() -> dict:
    bundle_bytes = FONT_BUNDLE.read_bytes()
    env = UnityPy.load(str(FONT_BUNDLE))
    objects = {int(obj.path_id): obj for obj in env.objects}
    sprite_obj = objects[SPRITE_ASSET_ID]
    material_obj = objects[MATERIAL_ID]
    texture_obj = objects[TEXTURE_ID]
    sprite = sprite_obj.read_typetree()
    material = material_obj.read_typetree()
    texture = texture_obj.read()

    if sprite.get("m_Name") != "TextExSprite" or material.get("m_Name") != "TextExSprite":
        raise RuntimeError("official TextExSprite object identity changed")
    if pointer(sprite.get("material"))["pathId"] != str(MATERIAL_ID):
        raise RuntimeError("TextExSprite material binding changed")
    if pointer(sprite.get("spriteSheet"))["pathId"] != str(TEXTURE_ID):
        raise RuntimeError("TextExSprite texture binding changed")

    image = texture.image.convert("RGBA")
    rgba_bytes = image.tobytes()
    png_buffer = BytesIO()
    image.save(png_buffer, format="PNG", optimize=False, compress_level=9)
    png_bytes = png_buffer.getvalue()
    compressed_payload = texture.get_image_data()
    settings = texture.m_TextureSettings

    properties = material.get("m_SavedProperties", {})
    tex_envs = {name: value for name, value in properties.get("m_TexEnvs", [])}
    floats = {name: float(value) for name, value in properties.get("m_Floats", [])}
    colors = {name: color(value) for name, value in properties.get("m_Colors", [])}

    elf = Elf64(IL2CPP)
    script_path = IL2CPP_OUT / "script.json"
    script_bytes = script_path.read_bytes()
    script = json.loads(script_bytes)
    methods = script["ScriptMethod"]
    literals_path = IL2CPP_OUT / "stringliteral.json"
    literals_bytes = literals_path.read_bytes()
    literals = json.loads(literals_bytes)
    format_value = "<space=-0.01em><size={0}><sprite={1}><space=-0.1em></size>"
    literal = next(item for item in literals if item.get("value") == format_value)
    index_table = elf.range(0x1AF6700, 0x1AF6710)
    index_values = list(struct.unpack("<4i", index_table))

    text_generator_bytes = TEXT_GENERATOR.read_bytes()
    text_generator_lines = text_generator_bytes.decode("utf-8-sig").splitlines(keepends=True)
    return {
        "schemaVersion": 1,
        "unityVersion": UNITY_VERSION,
        "gameVersion": "1.6.0",
        "source": {
            "fontBundle": {
                "path": "PCR_OFFICIAL_FONT_BUNDLE",
                "byteSize": len(bundle_bytes),
                "sha256": sha256(bundle_bytes),
            },
            "il2cpp": {
                "path": "PCR_IL2CPP",
                "byteSize": len(elf.data),
                "sha256": sha256(elf.data),
            },
            "il2cppDumper": {
                "scriptJsonSha256": sha256(script_bytes),
                "stringLiteralJsonSha256": sha256(literals_bytes),
            },
            "textGenerator": {
                "path": "UnityCsReference/Modules/TextCoreTextEngine/Managed/TextGenerator.cs",
                "byteSize": len(text_generator_bytes),
                "sha256": sha256(text_generator_bytes),
                "spriteScaleBranch": source_range(text_generator_lines, 900, 946),
                "vertexPositionBranch": source_range(text_generator_lines, 1200, 1222),
                "advanceBranch": source_range(text_generator_lines, 2028, 2042),
                "spaceTagBranch": source_range(text_generator_lines, 4100, 4115),
            },
        },
        "preprocessor": {
            "methods": {
                "preProcessEx": method_record(
                    elf, methods,
                    "Lettuce.Infrastructure.LocLabel.TagCommandImpl.LtUIImgTagCommand$$PreProcessEX",
                ),
                "getFontSize": method_record(
                    elf, methods,
                    "Lettuce.Infrastructure.LocLabel.TagCommandImpl.LtUIImgTagCommand$$GetFontSize",
                ),
                "getRuleImgTagFontType": method_record(
                    elf, methods,
                    "Lettuce.Infrastructure.Card.Core.PokemonCardUIBehaviour$$GetRuleImgTagFontType",
                ),
            },
            "formatLiteral": {"address": literal["address"], "value": literal["value"]},
            "spriteIndexTable": {
                "rva": "0x1af6700",
                "bytes": index_table.hex(),
                "sha256": sha256(index_table),
                "values": index_values,
            },
            "fontTypeToSpriteIndex": {
                "Black": index_values[0],
                "White": index_values[1],
                "BlackWithWhiteOutline": index_values[2],
                "ExBlack": index_values[3],
            },
            "pokemonRuleSelection": {"normalEx": "ExBlack", "megaEx": "White"},
            "defaultFontSize": 23.0,
            "spaceBeforeEm": -0.01,
            "spaceAfterEm": -0.1,
        },
        "spriteAsset": {
            "pathId": str(SPRITE_ASSET_ID),
            "objectSha256": sha256(sprite_obj.get_raw_data()),
            "name": sprite["m_Name"],
            "hashCode": int(sprite["hashCode"]),
            "version": sprite["m_Version"],
            "material": pointer(sprite["material"]),
            "spriteSheet": pointer(sprite["spriteSheet"]),
            "faceInfo": {
                "pointSize": float(sprite["m_FaceInfo"]["m_PointSize"]),
                "scale": float(sprite["m_FaceInfo"]["m_Scale"]),
                "ascentLine": float(sprite["m_FaceInfo"]["m_AscentLine"]),
                "descentLine": float(sprite["m_FaceInfo"]["m_DescentLine"]),
            },
            "characters": [{
                "name": value["m_Name"],
                "unicode": int(value["m_Unicode"]),
                "glyphIndex": int(value["m_GlyphIndex"]),
                "scale": float(value["m_Scale"]),
                "hashCode": int(value["m_HashCode"]),
            } for value in sprite["m_SpriteCharacterTable"]],
            "glyphs": [{
                "index": int(value["m_Index"]),
                "metrics": {
                    "width": float(value["m_Metrics"]["m_Width"]),
                    "height": float(value["m_Metrics"]["m_Height"]),
                    "horizontalBearingX": float(value["m_Metrics"]["m_HorizontalBearingX"]),
                    "horizontalBearingY": float(value["m_Metrics"]["m_HorizontalBearingY"]),
                    "horizontalAdvance": float(value["m_Metrics"]["m_HorizontalAdvance"]),
                },
                "glyphRect": {
                    "x": int(value["m_GlyphRect"]["m_X"]),
                    "y": int(value["m_GlyphRect"]["m_Y"]),
                    "width": int(value["m_GlyphRect"]["m_Width"]),
                    "height": int(value["m_GlyphRect"]["m_Height"]),
                },
                "scale": float(value["m_Scale"]),
                "atlasIndex": int(value["m_AtlasIndex"]),
                "sprite": pointer(value["sprite"]),
            } for value in sprite["m_SpriteGlyphTable"]],
            "fallbackSpriteAssets": [pointer(value) for value in sprite["fallbackSpriteAssets"]],
        },
        "material": {
            "pathId": str(MATERIAL_ID),
            "objectSha256": sha256(material_obj.get_raw_data()),
            "name": material["m_Name"],
            "shader": pointer(material["m_Shader"]),
            "customRenderQueue": int(material["m_CustomRenderQueue"]),
            "mainTexture": pointer(tex_envs["_MainTex"]["m_Texture"]),
            "floats": floats,
            "colors": colors,
        },
        "texture": {
            "pathId": str(TEXTURE_ID),
            "objectSha256": sha256(texture_obj.get_raw_data()),
            "name": texture.m_Name,
            "width": int(texture.m_Width),
            "height": int(texture.m_Height),
            "textureFormat": int(texture.m_TextureFormat),
            "mipCount": int(texture.m_MipCount),
            "compressedPayloadByteSize": len(compressed_payload),
            "compressedPayloadSha256": sha256(compressed_payload),
            "decodedRgbaSha256": sha256(rgba_bytes),
            "pngByteSize": len(png_bytes),
            "pngSha256": sha256(png_bytes),
            "url": "/game/tmp-sprites/TextExSprite.png",
            "sampler": {
                "filterMode": int(settings.m_FilterMode),
                "aniso": int(settings.m_Aniso),
                "mipBias": float(settings.m_MipBias),
                "wrapU": int(settings.m_WrapU),
                "wrapV": int(settings.m_WrapV),
                "wrapW": int(settings.m_WrapW),
            },
        },
        "layout": {
            "orthographic": True,
            "spriteFacePointSizeZeroBranch": True,
            "currentElementScale": "fontAscent / glyphHeight * characterScale * glyphScale * spriteScale",
            "spriteScale": "tagFontSize / fontPointSize * fontScale",
            "topLeftX": "xAdvance + horizontalBearingX * currentElementScale",
            "topLeftY": "baseline + horizontalBearingY * currentElementScale",
            "quadWidth": "glyphWidth * currentElementScale",
            "quadHeight": "glyphHeight * currentElementScale",
            "spriteAdvance": "horizontalAdvance * currentElementScale",
            "tokenAdvance": "spaceBeforeEm * tagFontSize + spriteAdvance + spaceAfterEm * tagFontSize",
        },
        "_pngBase64": base64.b64encode(png_bytes).decode("ascii"),
    }


if __name__ == "__main__":
    print(json.dumps(extract(), ensure_ascii=True, separators=(",", ":")))
