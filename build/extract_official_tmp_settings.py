#!/usr/bin/env python3
"""Extract the TextMeshPro settings and East Asian line-breaking tables from the official APK."""

from __future__ import annotations

import argparse
import gc
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile

import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
DATA_PREFIX = "assets/bin/Data/"
UNITY_VERSION = "2022.3.62f2"
IL2CPP = Path(os.environ.get(
    "PCR_IL2CPP",
    ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "libil2cpp.so",
))
IL2CPP_SCRIPT = Path(os.environ.get(
    "PCR_IL2CPP_SCRIPT",
    ROOT.parent / "ptcg-apk-parser" / "tools" / "vendor" / "Il2CppDumper" / "out" / "script.json",
))
TMP_PACKAGE = Path(os.environ.get(
    "PCR_TMP_PACKAGE",
    "C:/Users/Admin/AppData/Local/Temp/tmp-3.0.6/package",
))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class RawReader:
    def __init__(self, data: bytes, offset: int):
        self.data = data
        self.offset = offset

    def align4(self) -> None:
        self.offset = (self.offset + 3) & ~3

    def bool4(self) -> bool:
        value = bool(self.data[self.offset])
        if any(self.data[self.offset + 1:self.offset + 4]):
            raise ValueError(f"nonzero bool padding at 0x{self.offset:x}")
        self.offset += 4
        return value

    def int32(self) -> int:
        value = struct.unpack_from("<i", self.data, self.offset)[0]
        self.offset += 4
        return value

    def uint32(self) -> int:
        value = struct.unpack_from("<I", self.data, self.offset)[0]
        self.offset += 4
        return value

    def float32(self) -> float:
        value = struct.unpack_from("<f", self.data, self.offset)[0]
        self.offset += 4
        return value

    def vec2(self) -> dict:
        value = struct.unpack_from("<ff", self.data, self.offset)
        self.offset += 8
        return {"x": value[0], "y": value[1]}

    def pptr(self) -> dict:
        file_id, path_id = struct.unpack_from("<iq", self.data, self.offset)
        self.offset += 12
        return {"fileId": file_id, "pathId": path_id}

    def string(self) -> str:
        size = self.int32()
        if size < 0 or self.offset + size > len(self.data):
            raise ValueError(f"invalid string size at 0x{self.offset - 4:x}")
        value = self.data[self.offset:self.offset + size].decode("utf-8")
        self.offset += size
        self.align4()
        return value

    def pptr_list(self) -> list[dict]:
        size = self.int32()
        if size < 0 or size > 4096:
            raise ValueError(f"invalid PPtr list size at 0x{self.offset - 4:x}")
        return [self.pptr() for _ in range(size)]


class Elf64:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.data = self.path.read_bytes()
        if self.data[:6] != b"\x7fELF\x02\x01":
            raise ValueError(f"{path}: expected little-endian ELF64")
        phoff = struct.unpack_from("<Q", self.data, 0x20)[0]
        entsize = struct.unpack_from("<H", self.data, 0x36)[0]
        count = struct.unpack_from("<H", self.data, 0x38)[0]
        self.loads = []
        for index in range(count):
            values = struct.unpack_from("<IIQQQQQQ", self.data, phoff + index * entsize)
            if values[0] == 1:
                self.loads.append((values[2], values[3], values[5]))

    def offset_of(self, rva: int) -> int:
        for offset, vaddr, file_size in self.loads:
            if vaddr <= rva < vaddr + file_size:
                return offset + rva - vaddr
        raise ValueError(f"RVA is not file-backed: 0x{rva:x}")

    def range(self, start: int, end: int) -> bytes:
        return self.data[self.offset_of(start):self.offset_of(end)]


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


def source_record(
    path: Path,
    logical_path: str,
    ranges: dict[str, tuple[int, int]] | None = None,
) -> dict:
    data = path.read_bytes()
    lines = data.decode("utf-8-sig").splitlines(keepends=True)
    result = {
        "path": logical_path,
        "byteSize": len(data),
        "sha256": sha256(data),
    }
    if ranges:
        result["ranges"] = {
            name: {
                "startLine": start,
                "endLine": end,
                "sha256": sha256("".join(lines[start - 1:end]).encode("utf-8")),
            }
            for name, (start, end) in ranges.items()
        }
    return result


def decode_settings(raw: bytes) -> dict:
    reader = RawReader(raw, 0x2C)
    result = {
        "enableWordWrapping": reader.bool4(),
        "enableKerning": reader.bool4(),
        "enableExtraPadding": reader.bool4(),
        "enableTintAllSprites": reader.bool4(),
        "enableParseEscapeCharacters": reader.bool4(),
        "enableRaycastTarget": reader.bool4(),
        "getFontFeaturesAtRuntime": reader.bool4(),
        "missingGlyphCharacter": reader.int32(),
        "warningsDisabled": reader.bool4(),
        "defaultFontAssetPPtr": reader.pptr(),
        "defaultFontAssetPath": reader.string(),
        "defaultFontSize": reader.float32(),
        "defaultAutoSizeMinRatio": reader.float32(),
        "defaultAutoSizeMaxRatio": reader.float32(),
        "defaultTextMeshProTextContainerSize": reader.vec2(),
        "defaultTextMeshProUITextContainerSize": reader.vec2(),
        "autoSizeTextContainer": reader.bool4(),
        "isTextObjectScaleStatic": reader.bool4(),
        "fallbackFontAssetPPtrs": reader.pptr_list(),
        "matchMaterialPreset": reader.bool4(),
        "defaultSpriteAssetPPtr": reader.pptr(),
        "defaultSpriteAssetPath": reader.string(),
        "enableEmojiSupport": reader.bool4(),
        "missingCharacterSpriteUnicode": reader.uint32(),
        "defaultColorGradientPresetsPath": reader.string(),
        "defaultStyleSheetPPtr": reader.pptr(),
        "styleSheetsResourcePath": reader.string(),
        "leadingCharactersPPtr": reader.pptr(),
        "followingCharactersPPtr": reader.pptr(),
        "useModernHangulLineBreakingRules": reader.bool4(),
    }
    if reader.offset != len(raw):
        raise ValueError(f"TMP Settings parser stopped at 0x{reader.offset:x} of 0x{len(raw):x}")
    return result


def object_name(obj: object) -> str:
    try:
        return str(obj.peek_name())
    except Exception:
        return ""


def object_record(obj: object, name: str) -> dict:
    raw = obj.get_raw_data()
    return {
        "name": name,
        "assetFile": str(obj.assets_file.name),
        "pathId": int(obj.path_id),
        "rawByteSize": len(raw),
        "rawSha256": sha256(raw),
    }


def text_asset_record(obj: object, name: str) -> dict:
    record = object_record(obj, name)
    value = obj.read()
    text = value.m_Script if hasattr(value, "m_Script") else value.script
    if isinstance(text, bytes):
        text = text.decode("utf-8-sig")
    record["text"] = str(text).removeprefix("\ufeff")
    return record


def extract(apkm: Path) -> dict:
    with zipfile.ZipFile(apkm) as outer:
        base_apk = outer.read("base.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as inner, tempfile.TemporaryDirectory() as temp:
        data_root = Path(temp) / "Data"
        data_root.mkdir()
        for name in inner.namelist():
            if not name.startswith(DATA_PREFIX) or name.endswith("/"):
                continue
            relative = name[len(DATA_PREFIX):]
            target = data_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(inner.read(name))
        UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
        env = UnityPy.load(str(data_root))

        settings_obj = next(
            obj for obj in env.objects
            if obj.type.name == "MonoBehaviour" and object_name(obj) == "TMP Settings"
        )
        leading_obj = next(
            obj for obj in env.objects
            if obj.type.name == "TextAsset" and object_name(obj) == "LineBreaking Leading Characters"
        )
        following_obj = next(
            obj for obj in env.objects
            if obj.type.name == "TextAsset" and object_name(obj) == "LineBreaking Following Characters"
        )

        raw = settings_obj.get_raw_data()
        if len(raw) != 248:
            raise ValueError(f"unexpected TMP Settings object size: {len(raw)}")
        decoded = decode_settings(raw)

        elf = Elf64(IL2CPP)
        script_bytes = IL2CPP_SCRIPT.read_bytes()
        methods = json.loads(script_bytes)["ScriptMethod"]
        package_json = json.loads((TMP_PACKAGE / "package.json").read_text(encoding="utf-8"))
        if package_json.get("name") != "com.unity.textmeshpro" or package_json.get("version") != "3.0.6":
            raise ValueError("unexpected TextMeshPro package identity")

        result = {
            "schemaVersion": 2,
            "officialSample": "PTCGP 1.6.0",
            "unityVersion": UNITY_VERSION,
            "textMeshProVersion": "3.0.6",
            "source": {
                "apkm": apkm.name,
                "baseApkByteSize": len(base_apk),
                "baseApkSha256": sha256(base_apk),
                "il2cpp": {
                    "path": "PCR_IL2CPP",
                    "byteSize": len(elf.data),
                    "sha256": sha256(elf.data),
                },
                "il2cppDumperScriptSha256": sha256(script_bytes),
                "textMeshProPackage": {
                    "package": source_record(
                        TMP_PACKAGE / "package.json",
                        "com.unity.textmeshpro@3.0.6/package.json",
                    ),
                    "settings": source_record(
                        TMP_PACKAGE / "Scripts" / "Runtime" / "TMP_Settings.cs",
                        "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMP_Settings.cs",
                    ),
                    "fontAssetUtilities": source_record(
                        TMP_PACKAGE / "Scripts" / "Runtime" / "TMP_FontAssetUtilities.cs",
                        "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMP_FontAssetUtilities.cs",
                        {
                            "singleFontRecursiveSearch": (47, 197),
                            "fontListRecursiveSearch": (214, 248),
                        },
                    ),
                    "uguiGenerator": source_record(
                        TMP_PACKAGE / "Scripts" / "Runtime" / "TMPro_UGUI_Private.cs",
                        "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMPro_UGUI_Private.cs",
                        {"missingGlyphResolution": (1207, 1276)},
                    ),
                },
            },
            "settings": {
                **object_record(settings_obj, "TMP Settings"),
                **decoded,
            },
            "native": {
                "getTextElement": method_record(elf, methods, "TMPro.TMP_Text$$GetTextElement"),
                "generateTextMesh": method_record(elf, methods, "TMPro.TextMeshProUGUI$$GenerateTextMesh"),
            },
            "lineBreaking": {
                "leadingCharacters": text_asset_record(leading_obj, "LineBreaking Leading Characters"),
                "followingCharacters": text_asset_record(following_obj, "LineBreaking Following Characters"),
            },
        }
        del settings_obj, leading_obj, following_obj, env
        gc.collect()
        return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apkm", type=Path, default=DEFAULT_APKM)
    args = parser.parse_args()
    print(json.dumps(extract(args.apkm.resolve()), ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
