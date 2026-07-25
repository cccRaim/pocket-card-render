#!/usr/bin/env python3
"""Byte-audit Unity SDFAA glyph atlas pixels against official FontAssets.

The distance transform and output conversion execute the exact ARM64 bytes
from Pokemon TCG Pocket's libunity.so under Unicorn. FreeType supplies the
same no-hinting grayscale glyph bitmap requested by TextCore render mode
0x1045. No screenshot, renderer output, or inferred SDF implementation is
used.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import warnings

import freetype
import UnityPy
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
from unicorn.arm64_const import (
    UC_ARM64_REG_LR,
    UC_ARM64_REG_SP,
    UC_ARM64_REG_X0,
    UC_ARM64_REG_X1,
    UC_ARM64_REG_X2,
    UC_ARM64_REG_X3,
    UC_ARM64_REG_X4,
    UC_ARM64_REG_X5,
    UC_ARM64_REG_X19,
    UC_ARM64_REG_X20,
    UC_ARM64_REG_X21,
    UC_ARM64_REG_X27,
    UC_ARM64_REG_X28,
    UC_ARM64_REG_X29,
)


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / ".cache"
DECRYPTED = Path(
    os.environ.get(
        "PCR_DECRYPTED_ROOT",
        "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
    )
)
FONT_BUNDLE = DECRYPTED / "Common" / "Font_bundles"
CONTRACT = ROOT / "public" / "render" / "card-font-contract.json"
MANIFEST = ROOT / "public" / "game" / "tmp-fonts" / "manifest.json"
GAME_LIBUNITY = Path(
    os.environ.get("PCR_GAME_LIBUNITY", CACHE / "ptcgp-1.6.0/libunity.so")
)

LOAD_FLAGS = freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_RENDER
EXPECTED_GAME_SHA256 = "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722"
CALCULATE_RVA = 0x8D44BC
OUTPUT_LOOP_RVA = 0x8D273C
OUTPUT_LOOP_END_RVA = 0x8D2828
RETURN_RVA = 0x8D5F00
PIXEL_STRIDE = 32

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class NativeSdfAa:
    CODE_BASE = 0x8D2000
    CODE_SIZE = 0x4000
    RODATA_BASE = 0x100000
    RODATA_SIZE = 0x100000
    DATA_BASE = 0x2000000
    DATA_SIZE = 0x800000
    SOURCE = DATA_BASE
    FIELD_A = DATA_BASE + 0x100000
    FIELD_B = DATA_BASE + 0x300000
    OUTPUT = DATA_BASE + 0x500000
    STACK = DATA_BASE + DATA_SIZE - 0x10000

    def __init__(self, game_bytes: bytes):
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        self.uc.mem_map(self.RODATA_BASE, self.RODATA_SIZE)
        self.uc.mem_write(
            self.RODATA_BASE,
            game_bytes[self.RODATA_BASE : self.RODATA_BASE + self.RODATA_SIZE],
        )
        self.uc.mem_map(self.CODE_BASE, self.CODE_SIZE)
        # The executable PT_LOAD has a +0x4000 virtual-address bias.
        code_offset = self.CODE_BASE - 0x4000
        self.uc.mem_write(
            self.CODE_BASE,
            game_bytes[code_offset : code_offset + self.CODE_SIZE],
        )
        self.uc.mem_map(self.DATA_BASE, self.DATA_SIZE)
        self.uc.mem_write(RETURN_RVA, b"\xc0\x03\x5f\xd6")  # ret

    def _calculate(
        self,
        source: bytes,
        width: int,
        height: int,
        padding: int,
        invert: int,
        target: int,
        target_size: int,
    ) -> None:
        self.uc.mem_write(self.SOURCE, source)
        self.uc.mem_write(target, bytes(target_size))
        for register, value in (
            (UC_ARM64_REG_X0, self.SOURCE),
            (UC_ARM64_REG_X1, width),
            (UC_ARM64_REG_X2, height),
            (UC_ARM64_REG_X3, padding),
            (UC_ARM64_REG_X4, invert),
            (UC_ARM64_REG_X5, target),
            (UC_ARM64_REG_SP, self.STACK),
            (UC_ARM64_REG_LR, RETURN_RVA),
        ):
            self.uc.reg_write(register, value)
        self.uc.emu_start(CALCULATE_RVA, RETURN_RVA, count=20_000_000)

    def render(
        self,
        source: bytes,
        width: int,
        height: int,
        padding: int,
    ) -> bytes:
        padded_width = width + padding * 2
        padded_height = height + padding * 2
        field_size = padded_width * padded_height * PIXEL_STRIDE
        if field_size > 0x1F0000:
            raise RuntimeError(f"glyph field exceeds emulator allocation: {field_size}")
        self._calculate(source, width, height, padding, 0, self.FIELD_A, field_size)
        self._calculate(source, width, height, padding, 1, self.FIELD_B, field_size)

        output_size = padded_width * padded_height
        self.uc.mem_write(self.OUTPUT, bytes(output_size))
        self.uc.mem_write(self.STACK + 0xC, padded_width.to_bytes(4, "little"))
        for register, value in (
            (UC_ARM64_REG_X19, self.OUTPUT + (padded_height - 1) * padded_width),
            (UC_ARM64_REG_X20, self.FIELD_A),
            (UC_ARM64_REG_X21, self.FIELD_B),
            (UC_ARM64_REG_X27, padded_width),
            (UC_ARM64_REG_X28, padded_height),
            (UC_ARM64_REG_X29, padding),
            (UC_ARM64_REG_SP, self.STACK),
        ):
            self.uc.reg_write(register, value)
        self.uc.emu_start(OUTPUT_LOOP_RVA, OUTPUT_LOOP_END_RVA, count=2_000_000)

        # Generate_3X3AAEDT writes top-to-bottom source rows into a destination
        # whose pointer starts on the bottom row and advances by -pitch.
        raw = bytes(self.uc.mem_read(self.OUTPUT, output_size))
        rows = [
            raw[row * padded_width : (row + 1) * padded_width]
            for row in range(padded_height)
        ]
        return b"".join(reversed(rows))


def sampled_glyphs(glyphs: list[dict], audit_all: bool) -> list[dict]:
    visible = [
        glyph
        for glyph in glyphs
        if glyph["m_GlyphRect"]["m_Width"] > 0 and glyph["m_GlyphRect"]["m_Height"] > 0
    ]
    if audit_all or len(visible) <= 3:
        return visible
    largest = max(
        visible,
        key=lambda glyph: glyph["m_GlyphRect"]["m_Width"] * glyph["m_GlyphRect"]["m_Height"],
    )
    selected = {int(visible[0]["m_Index"]), int(visible[-1]["m_Index"]), int(largest["m_Index"])}
    return [glyph for glyph in visible if int(glyph["m_Index"]) in selected]


def atlas_region(
    atlas: bytes,
    atlas_width: int,
    rect: dict,
    padding: int,
) -> bytes:
    x0 = int(rect["m_X"]) - padding
    y0 = int(rect["m_Y"]) - padding
    width = int(rect["m_Width"]) + padding * 2
    height = int(rect["m_Height"]) + padding * 2
    if x0 < 0 or y0 < 0:
        raise RuntimeError(f"glyph padding is outside atlas: {rect}")
    rows = []
    for y in range(y0 + height - 1, y0 - 1, -1):
        start = y * atlas_width + x0
        rows.append(atlas[start : start + width])
    return b"".join(rows)


def main() -> None:
    audit_all = "--sample" not in os.sys.argv
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    game_bytes = GAME_LIBUNITY.read_bytes()
    if sha256(game_bytes) != EXPECTED_GAME_SHA256:
        raise RuntimeError("official game libunity hash drifted")
    env = UnityPy.load(str(FONT_BUNDLE))
    objects = {obj.path_id: obj for obj in env.objects}
    emulator = NativeSdfAa(game_bytes)
    rows = []
    glyph_count = 0
    pixel_count = 0
    payload_pinned_pixels = 0

    for font_id in sorted(contract["fonts"], key=int):
        font_obj = objects[int(font_id)]
        data = font_obj.read_typetree()
        padding = int(data["m_AtlasPadding"])
        if int(data["m_AtlasRenderMode"]) != 4165:
            raise RuntimeError(f"FontAsset {font_id} is not SDFAA mode 0x1045")
        source_id = int(data.get("m_SourceFontFile", {}).get("m_PathID", 0))
        source_obj = objects[source_id].read() if source_id else None
        atlases = []
        for atlas_index, pointer in enumerate(data["m_AtlasTextures"]):
            atlas_obj = objects[pointer["m_PathID"]].read()
            atlas = bytes(atlas_obj.image_data)
            atlas_width = int(atlas_obj.m_Width)
            if len(atlas) != atlas_width * int(atlas_obj.m_Height):
                raise RuntimeError(f"FontAsset {font_id} atlas is not uncompressed Alpha8")
            expected_atlas = manifest["fonts"][font_id]["atlases"][atlas_index]
            if sha256(atlas) != expected_atlas["alphaPayloadSha256"]:
                raise RuntimeError(f"FontAsset {font_id} atlas {atlas_index} payload hash drifted")
            atlases.append((atlas, atlas_width))

        if source_obj is None:
            if contract["fonts"][font_id].get("source") is not None:
                raise RuntimeError(f"FontAsset {font_id} unexpectedly lost its source Font object")
            selected = sampled_glyphs(data.get("m_GlyphTable", []), audit_all)
            for glyph in selected:
                rect = glyph["m_GlyphRect"]
                atlas_index = int(glyph.get("m_AtlasIndex", 0))
                if not 0 <= atlas_index < len(atlases):
                    raise RuntimeError(f"font={font_id}: invalid static atlas index {atlas_index}")
                atlas, atlas_width = atlases[atlas_index]
                official = atlas_region(atlas, atlas_width, rect, padding)
                if not official or max(official) == 0:
                    raise RuntimeError(f"font={font_id} glyph={glyph['m_Index']}: static atlas region is empty")
                glyph_count += 1
                payload_pinned_pixels += len(official)
            rows.append({
                "fontId": font_id,
                "name": data.get("m_Name"),
                "glyphsChecked": len(selected),
                "evidence": "official-static-alpha8-payload-hash",
            })
            continue

        with tempfile.NamedTemporaryFile(suffix=".otf", delete=False) as handle:
            handle.write(bytes(source_obj.m_FontData))
            source_name = handle.name
        try:
            face = freetype.Face(source_name)
            face.set_pixel_sizes(0, round(data["m_FaceInfo"]["m_PointSize"]))
            selected = sampled_glyphs(data.get("m_GlyphTable", []), audit_all)
            for glyph in selected:
                glyph_index = int(glyph["m_Index"])
                face.load_glyph(glyph_index, LOAD_FLAGS)
                bitmap = face.glyph.bitmap
                rect = glyph["m_GlyphRect"]
                if bitmap.pixel_mode != freetype.FT_PIXEL_MODE_GRAY:
                    raise RuntimeError(f"font={font_id} glyph={glyph_index}: expected grayscale bitmap")
                if bitmap.pitch != bitmap.width:
                    raise RuntimeError(f"font={font_id} glyph={glyph_index}: unexpected FT bitmap pitch")
                if (bitmap.width, bitmap.rows) != (rect["m_Width"], rect["m_Height"]):
                    raise RuntimeError(f"font={font_id} glyph={glyph_index}: bitmap/rect dimensions differ")
                generated = emulator.render(
                    bytes(bitmap.buffer), bitmap.width, bitmap.rows, padding
                )
                atlas_index = int(glyph.get("m_AtlasIndex", 0))
                if not 0 <= atlas_index < len(atlases):
                    raise RuntimeError(f"font={font_id} glyph={glyph_index}: invalid atlas index {atlas_index}")
                atlas, atlas_width = atlases[atlas_index]
                official = atlas_region(atlas, atlas_width, rect, padding)
                if generated != official:
                    differences = sum(a != b for a, b in zip(generated, official))
                    raise RuntimeError(
                        f"font={font_id} glyph={glyph_index}: {differences}/{len(official)} atlas pixels differ"
                    )
                glyph_count += 1
                pixel_count += len(official)
            rows.append(
                {
                    "fontId": font_id,
                    "name": data.get("m_Name"),
                    "glyphsChecked": len(selected),
                    "evidence": "native-sdfaa-regeneration",
                }
            )
        finally:
            os.unlink(source_name)

    report = {
        "schemaVersion": 1,
        "unityVersion": "2022.3.62f2",
        "gameVersion": "1.6.0",
        "renderMode": 4165,
        "loadFlags": int(LOAD_FLAGS),
        "scope": "all-preloaded-visible-glyphs" if audit_all else "three-deterministic-glyphs-per-font",
        "fontAssetsChecked": len(rows),
        "glyphsChecked": glyph_count,
        "pixelsChecked": pixel_count,
        "payloadPinnedPixels": payload_pinned_pixels,
        "differentPixels": 0,
        "fonts": rows,
    }
    if "--json" in os.sys.argv:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print("Official TMP SDFAA atlas pixel audit OK")
        print(f"FontAssets: {len(rows)}")
        print(f"Glyphs: {glyph_count}; regenerated pixels: {pixel_count}; different: 0")
        print(f"Static payload-pinned pixels: {payload_pinned_pixels}")
        print(f"Scope: {report['scope']}")


if __name__ == "__main__":
    main()
