#!/usr/bin/env python3
"""Extract candidate TextExSprite serialized and native preprocessor facts."""

from __future__ import annotations

import argparse
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import struct
import sys
import warnings

from capstone import CS_ARCH_ARM64, CS_MODE_ARM, Cs
import UnityPy

from official_sample import load_official_sample


sys.dont_write_bytecode = True
FONT_BUNDLE_LOGICAL_PATH = "Common/Font_bundles"
SPRITE_ASSET_ID = 840073264968542736
MATERIAL_ID = -1050951510632854060
TEXTURE_ID = 3209478181533236899
FORMAT_LITERAL = "<space=-0.01em><size={0}><sprite={1}><space=-0.1em></size>"
METHOD_NAMES = {
    "preProcessEx":
        "Lettuce.Infrastructure.LocLabel.TagCommandImpl."
        "LtUIImgTagCommand$$PreProcessEX",
    "getFontSize":
        "Lettuce.Infrastructure.LocLabel.TagCommandImpl."
        "LtUIImgTagCommand$$GetFontSize",
    "getRuleImgTagFontType":
        "Lettuce.Infrastructure.Card.Core."
        "PokemonCardUIBehaviour$$GetRuleImgTagFontType",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--decrypted-root", required=True)
    parser.add_argument("--il2cpp", required=True)
    parser.add_argument("--il2cpp-dumper-out", required=True)
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
            raise ValueError(f"{path}: expected ELF64 little-endian")
        phoff = struct.unpack_from("<Q", self.data, 0x20)[0]
        entry_size = struct.unpack_from("<H", self.data, 0x36)[0]
        count = struct.unpack_from("<H", self.data, 0x38)[0]
        self.loads = []
        for index in range(count):
            values = struct.unpack_from(
                "<IIQQQQQQ",
                self.data,
                phoff + index * entry_size,
            )
            if values[0] == 1:
                self.loads.append((values[2], values[3], values[5]))

    def offset(self, rva: int) -> int:
        for offset, vaddr, file_size in self.loads:
            if vaddr <= rva < vaddr + file_size:
                return offset + rva - vaddr
        raise ValueError(f"RVA is not file-backed: {rva:#x}")

    def range(self, start: int, end: int) -> bytes:
        if end < start:
            raise ValueError("invalid ELF range")
        return self.data[self.offset(start):self.offset(end)]


def disassemble(body: bytes, start: int) -> list[dict]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    instructions = [
        {
            "address": f"0x{instruction.address:x}",
            "mnemonic": instruction.mnemonic,
            "operands": instruction.op_str,
        }
        for instruction in decoder.disasm(body, start)
    ]
    if len(instructions) * 4 != len(body):
        raise ValueError(
            f"ARM64 decoder consumed {len(instructions) * 4} of {len(body)} bytes"
        )
    return instructions


def method_record(
    elf: Elf64,
    methods: list[dict],
    name: str,
) -> tuple[dict, bytes, list[dict]]:
    matches = [entry for entry in methods if entry.get("Name") == name]
    if len(matches) != 1:
        raise ValueError(f"expected one IL2CPP method {name}, found {len(matches)}")
    start = int(matches[0]["Address"])
    later = sorted({
        int(entry["Address"])
        for entry in methods
        if int(entry.get("Address", 0)) > start
    })
    if not later:
        raise ValueError(f"could not determine end of IL2CPP method {name}")
    end = later[0]
    body = elf.range(start, end)
    instructions = disassemble(body, start)
    record = {
        "name": name,
        "rva": f"0x{start:x}",
        "endRva": f"0x{end:x}",
        "byteSize": len(body),
        "sha256": sha256_bytes(body),
        "instructionCount": len(instructions),
        "instructionSha256": sha256_bytes(json.dumps(
            instructions,
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("ascii")),
    }
    return record, body, instructions


def instruction_text(instructions: list[dict]) -> list[str]:
    return [
        f"{entry['mnemonic']} {entry['operands']}".strip()
        for entry in instructions
    ]


def derive_sprite_index_table(
    elf: Elf64,
    instructions: list[dict],
) -> tuple[int, bytes, dict]:
    pages: dict[str, int] = {}
    candidates = []
    for index, instruction in enumerate(instructions):
        mnemonic = instruction["mnemonic"]
        operands = instruction["operands"]
        if mnemonic == "adrp":
            match = re.fullmatch(r"(x\d+), #0x([0-9a-f]+)", operands)
            if match:
                pages[match.group(1)] = int(match.group(2), 16)
            continue
        if mnemonic != "add":
            continue
        match = re.fullmatch(
            r"(x\d+), (x\d+), #0x([0-9a-f]+)",
            operands,
        )
        if not match or match.group(2) not in pages:
            continue
        address = pages[match.group(2)] + int(match.group(3), 16)
        try:
            payload = elf.range(address, address + 16)
        except ValueError:
            continue
        values = list(struct.unpack("<4i", payload))
        if values != [0, 2, 1, 3]:
            continue
        register = match.group(1)
        indexed_load = next((
            entry for entry in instructions[index + 1:]
            if entry["mnemonic"] == "ldr"
            and re.search(
                rf"\[{register}, w\d+, sxtw #2\]",
                entry["operands"],
            )
        ), None)
        if indexed_load:
            candidates.append((address, payload, instruction, indexed_load))
    if len(candidates) != 1:
        raise ValueError(
            f"expected one native sprite-index table, found {len(candidates)}"
        )
    address, payload, address_instruction, load_instruction = candidates[0]
    return address, payload, {
        "addressInstruction": address_instruction,
        "indexedLoadInstruction": load_instruction,
        "derivation": "ADRP+ADD target consumed by signed-indexed 32-bit LDR",
    }


def verify_native_semantics(
    records: dict,
    instructions: dict[str, list[dict]],
) -> dict:
    preprocess = instruction_text(instructions["preProcessEx"])
    font_size = instruction_text(instructions["getFontSize"])
    rule = instruction_text(instructions["getRuleImgTagFontType"])

    required_preprocess = [
        "fmov s1, #23.00000000",
        "sub w8, w9, #1",
        "cmp w8, #4",
    ]
    for fragment in required_preprocess:
        if fragment not in preprocess:
            raise ValueError(f"PreProcessEX instruction missing: {fragment}")
    if not any(
        re.fullmatch(r"ldr w\d+, \[x\d+, w\d+, sxtw #2\]", item)
        for item in preprocess
    ):
        raise ValueError("PreProcessEX has no signed indexed table load")

    for fragment in ["fcmp s9, #0.0", "fmov s9, s8"]:
        if fragment not in font_size:
            raise ValueError(f"GetFontSize instruction missing: {fragment}")

    expected_rule = [
        "ldrb w8, [x1, #0xac]",
        "mov w9, #4",
        "cmp w8, #0",
        "mov w8, #2",
        "csel w0, w9, w8, eq",
    ]
    for fragment in expected_rule:
        if fragment not in rule:
            raise ValueError(
                f"GetRuleImgTagFontType instruction missing: {fragment}"
            )
    return {
        "status": "exact-native-instruction-pattern",
        "preProcessEx": {
            "defaultFontSize": 23.0,
            "enumIndexBase": 1,
            "enumIndexCount": 4,
            "tableLoad": "signed 32-bit indexed by enum minus one",
        },
        "getFontSize": {
            "positiveRequestedSizeWins": True,
            "fallbackUsesDefaultSize": True,
        },
        "getRuleImgTagFontType": {
            "cardDataFieldOffset": "0xac",
            "zeroResult": 4,
            "nonZeroResult": 2,
            "zeroMeaning": "normalEx",
            "nonZeroMeaning": "megaEx",
        },
        "methodBodySha256": {
            key: records[key]["sha256"] for key in sorted(records)
        },
    }


def extract() -> dict:
    args = parse_args()
    loaded = load_official_sample(args.candidate_manifest)
    sample = loaded["sample"]
    if sample.get("status") != "candidate":
        raise ValueError("candidate TMP sprite extractor accepts candidate only")
    if args.unity_version != sample["unity"]["serializedVersion"]:
        raise ValueError("candidate Unity version mismatch")

    decrypted_root = Path(args.decrypted_root).resolve()
    font_bundle = decrypted_root / Path(FONT_BUNDLE_LOGICAL_PATH)
    il2cpp_path = Path(args.il2cpp).resolve()
    dumper_out = Path(args.il2cpp_dumper_out).resolve()
    if sha256_file(il2cpp_path) != sample["artifacts"]["libil2cpp"]["sha256"]:
        raise ValueError("candidate libil2cpp hash does not match manifest")
    if il2cpp_path.stat().st_size != sample["artifacts"]["libil2cpp"]["byteLength"]:
        raise ValueError("candidate libil2cpp size does not match manifest")

    UnityPy.config.FALLBACK_UNITY_VERSION = args.unity_version
    environment = UnityPy.load(str(font_bundle))
    objects = {int(obj.path_id): obj for obj in environment.objects}
    sprite_obj = objects.get(SPRITE_ASSET_ID)
    material_obj = objects.get(MATERIAL_ID)
    texture_obj = objects.get(TEXTURE_ID)
    if sprite_obj is None or material_obj is None or texture_obj is None:
        raise ValueError("candidate TextExSprite object set is incomplete")
    sprite = sprite_obj.read_typetree()
    material = material_obj.read_typetree()
    texture = texture_obj.read()
    if sprite.get("m_Name") != "TextExSprite":
        raise ValueError("candidate TextExSprite SpriteAsset identity changed")
    if material.get("m_Name") != "TextExSprite":
        raise ValueError("candidate TextExSprite Material identity changed")
    sprite_material_field = (
        "m_Material" if "m_Material" in sprite else "material"
    )
    sprite_glyph_table_field = (
        "m_GlyphTable"
        if "m_GlyphTable" in sprite
        else "m_SpriteGlyphTable"
    )
    if pointer(sprite.get(sprite_material_field))["pathId"] != str(MATERIAL_ID):
        raise ValueError("candidate TextExSprite material binding changed")
    if pointer(sprite.get("spriteSheet"))["pathId"] != str(TEXTURE_ID):
        raise ValueError("candidate TextExSprite texture binding changed")

    image = texture.image.convert("RGBA")
    rgba_bytes = image.tobytes()
    png_buffer = BytesIO()
    image.save(png_buffer, format="PNG", optimize=False, compress_level=9)
    png_bytes = png_buffer.getvalue()
    compressed_payload = texture.get_image_data()
    texture_settings = texture.m_TextureSettings

    properties = material.get("m_SavedProperties", {})
    tex_envs = {name: value for name, value in properties.get("m_TexEnvs", [])}
    floats = {name: float(value) for name, value in properties.get("m_Floats", [])}
    colors = {name: color(value) for name, value in properties.get("m_Colors", [])}

    script_path = dumper_out / "script.json"
    literals_path = dumper_out / "stringliteral.json"
    dump_path = dumper_out / "dump.cs"
    script_bytes = script_path.read_bytes()
    literals_bytes = literals_path.read_bytes()
    dump_bytes = dump_path.read_bytes()
    methods = json.loads(script_bytes)["ScriptMethod"]
    literals = json.loads(literals_bytes)
    literal_matches = [
        entry for entry in literals if entry.get("value") == FORMAT_LITERAL
    ]
    if len(literal_matches) != 1:
        raise ValueError(
            f"expected one EX format literal, found {len(literal_matches)}"
        )

    elf = Elf64(il2cpp_path)
    method_records = {}
    method_instructions = {}
    for key, name in METHOD_NAMES.items():
        record, _, instructions = method_record(elf, methods, name)
        method_records[key] = record
        method_instructions[key] = instructions
    table_rva, table_bytes, table_proof = derive_sprite_index_table(
        elf,
        method_instructions["preProcessEx"],
    )
    table_values = list(struct.unpack("<4i", table_bytes))
    native_semantics = verify_native_semantics(
        method_records,
        method_instructions,
    )

    return {
        "schema": "pocket-card-render/candidate-tmp-sprite-extract@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
        },
        "scope": {
            "serializedSpriteAsset": "exact",
            "nativePreprocessor": "exact-native-instruction-pattern",
            "unity6TextGeneratorLayout": "runtime-required",
            "runtimeCaptureUsed": False,
            "baselineUnity2022LayoutReused": False,
            "officialShaderRestorationPercent": None,
            "gameFidelity": False,
        },
        "source": {
            "fontBundle": {
                "logicalPath": FONT_BUNDLE_LOGICAL_PATH,
                "byteLength": font_bundle.stat().st_size,
                "sha256": sha256_file(font_bundle),
            },
            "il2cpp": {
                "logicalPath": "candidate arm64-v8a libil2cpp.so",
                "byteLength": len(elf.data),
                "sha256": sha256_bytes(elf.data),
            },
            "il2cppDumper": {
                "scriptJsonSha256": sha256_bytes(script_bytes),
                "stringLiteralJsonSha256": sha256_bytes(literals_bytes),
                "dumpCsSha256": sha256_bytes(dump_bytes),
            },
        },
        "preprocessor": {
            "methods": method_records,
            "nativeSemantics": native_semantics,
            "formatLiteral": {
                "address": literal_matches[0]["address"],
                "value": literal_matches[0]["value"],
            },
            "spriteIndexTable": {
                "rva": f"0x{table_rva:x}",
                "bytes": table_bytes.hex(),
                "sha256": sha256_bytes(table_bytes),
                "values": table_values,
                "proof": table_proof,
            },
            "fontTypeToSpriteIndex": {
                "Black": table_values[0],
                "White": table_values[1],
                "BlackWithWhiteOutline": table_values[2],
                "ExBlack": table_values[3],
            },
            "pokemonRuleSelection": {
                "normalEx": "ExBlack",
                "megaEx": "White",
            },
            "defaultFontSize": 23.0,
            "spaceBeforeEm": -0.01,
            "spaceAfterEm": -0.1,
        },
        "spriteAsset": {
            "pathId": str(SPRITE_ASSET_ID),
            "objectByteLength": len(sprite_obj.get_raw_data()),
            "objectSha256": sha256_bytes(sprite_obj.get_raw_data()),
            "name": sprite["m_Name"],
            "hashCode": (
                int(sprite["hashCode"]) if "hashCode" in sprite else None
            ),
            "version": sprite["m_Version"],
            "serializedFieldNames": sorted(sprite),
            "fieldBindings": {
                "material": sprite_material_field,
                "glyphTable": sprite_glyph_table_field,
                "characterTable": "m_SpriteCharacterTable",
                "spriteSheet": "spriteSheet",
            },
            "material": pointer(sprite[sprite_material_field]),
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
                "hashCode": (
                    int(value["m_HashCode"])
                    if "m_HashCode" in value
                    else None
                ),
            } for value in sprite["m_SpriteCharacterTable"]],
            "glyphs": [{
                "index": int(value["m_Index"]),
                "metrics": {
                    "width": float(value["m_Metrics"]["m_Width"]),
                    "height": float(value["m_Metrics"]["m_Height"]),
                    "horizontalBearingX":
                        float(value["m_Metrics"]["m_HorizontalBearingX"]),
                    "horizontalBearingY":
                        float(value["m_Metrics"]["m_HorizontalBearingY"]),
                    "horizontalAdvance":
                        float(value["m_Metrics"]["m_HorizontalAdvance"]),
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
            } for value in sprite[sprite_glyph_table_field]],
            "fallbackSpriteAssets": [
                pointer(value) for value in sprite["fallbackSpriteAssets"]
            ],
        },
        "material": {
            "pathId": str(MATERIAL_ID),
            "objectByteLength": len(material_obj.get_raw_data()),
            "objectSha256": sha256_bytes(material_obj.get_raw_data()),
            "name": material["m_Name"],
            "shader": pointer(material["m_Shader"]),
            "customRenderQueue": int(material["m_CustomRenderQueue"]),
            "mainTexture": pointer(tex_envs["_MainTex"]["m_Texture"]),
            "floats": floats,
            "colors": colors,
        },
        "texture": {
            "pathId": str(TEXTURE_ID),
            "objectByteLength": len(texture_obj.get_raw_data()),
            "objectSha256": sha256_bytes(texture_obj.get_raw_data()),
            "name": texture.m_Name,
            "width": int(texture.m_Width),
            "height": int(texture.m_Height),
            "textureFormat": int(texture.m_TextureFormat),
            "mipCount": int(texture.m_MipCount),
            "compressedPayloadByteSize": len(compressed_payload),
            "compressedPayloadSha256": sha256_bytes(compressed_payload),
            "decodedRgbaSha256": sha256_bytes(rgba_bytes),
            "pngByteSize": len(png_bytes),
            "pngSha256": sha256_bytes(png_bytes),
            "url": "/game/tmp-sprites/TextExSprite.png",
            "sampler": {
                "filterMode": int(texture_settings.m_FilterMode),
                "aniso": int(texture_settings.m_Aniso),
                "mipBias": float(texture_settings.m_MipBias),
                "wrapU": int(texture_settings.m_WrapU),
                "wrapV": int(texture_settings.m_WrapV),
                "wrapW": int(texture_settings.m_WrapW),
            },
        },
        "layoutBoundary": {
            "status": "runtime-required",
            "baselineUnity2022LayoutReused": False,
            "requiredEvidence": [
                (
                    f"matching Unity {args.unity_version} TextGenerator source "
                    "or release symbols"
                ),
                "candidate guest TMP sprite quad positions and advance",
                "candidate guest SpriteAsset material and texture submission",
            ],
            "reason": (
                "candidate serialized glyph metrics and native tag preprocessing "
                "do not prove Unity 6 TextGenerator pointSize-zero layout semantics"
            ),
        },
        "_pngBase64": base64.b64encode(png_bytes).decode("ascii"),
    }


if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    json.dump(extract(), sys.stdout, ensure_ascii=True, separators=(",", ":"))
    sys.stdout.write("\n")
