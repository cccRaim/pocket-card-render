#!/usr/bin/env python3
"""Compare every serialized TMP glyph metric with the official source OTF.

Unity's SDFAA mode is explicitly no-hinting. This audit proves the metric
producer independently from the atlas pixels. Serialized FontAsset overrides
remain authoritative and are pinned separately.
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


ROOT = Path(__file__).resolve().parents[1]
DECRYPTED = Path(os.environ.get(
    "PCR_DECRYPTED_ROOT",
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
))
FONT_BUNDLE = DECRYPTED / "Common" / "Font_bundles"
CONTRACT = ROOT / "public" / "render" / "card-font-contract.json"
NO_HINT_FLAGS = freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_NO_BITMAP

# Futura's digit one is deliberately made tabular in the serialized FontAsset.
# All other fields still match the source OTF. This is data, not a tolerance.
SERIALIZED_OVERRIDES = {
    ("-757749988448016049", 20): {
        "character": 0x31,
        "field": "horizontalAdvance",
        "source": 23.125,
        "serialized": 20.0,
    },
}

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def metric_values(metrics) -> dict[str, float]:
    return {
        "width": metrics.width / 64,
        "height": metrics.height / 64,
        "horizontalBearingX": metrics.horiBearingX / 64,
        "horizontalBearingY": metrics.horiBearingY / 64,
        "horizontalAdvance": metrics.horiAdvance / 64,
    }


def serialized_values(metrics: dict) -> dict[str, float]:
    return {
        "width": metrics["m_Width"],
        "height": metrics["m_Height"],
        "horizontalBearingX": metrics["m_HorizontalBearingX"],
        "horizontalBearingY": metrics["m_HorizontalBearingY"],
        "horizontalAdvance": metrics["m_HorizontalAdvance"],
    }


def main() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    if contract.get("schemaVersion") != 2:
        raise RuntimeError("card font contract schema must be 2")
    expected_fonts = contract.get("fonts", {})
    if len(expected_fonts) != 14:
        raise RuntimeError(f"expected 14 used FontAssets, found {len(expected_fonts)}")

    env = UnityPy.load(str(FONT_BUNDLE))
    objects = {obj.path_id: obj for obj in env.objects}
    checked = 0
    exact = 0
    static_serialized = 0
    observed_overrides = {}
    font_rows = []

    for font_id in sorted(expected_fonts, key=int):
        obj = objects.get(int(font_id))
        if obj is None or obj.type.name != "MonoBehaviour":
            raise RuntimeError(f"FontAsset {font_id} is absent from the official bundle")
        data = obj.read_typetree()
        source_id = data.get("m_SourceFontFile", {}).get("m_PathID")
        source_obj = objects.get(source_id)
        if not source_id:
            if expected_fonts[font_id].get("source") is not None:
                raise RuntimeError(f"FontAsset {font_id} unexpectedly lost its source Font object")
            glyphs = data.get("m_GlyphTable", [])
            if not glyphs:
                raise RuntimeError(f"static FontAsset {font_id} has no serialized glyph metrics")
            static_serialized += len(glyphs)
            font_rows.append({
                "fontId": font_id,
                "name": data.get("m_Name"),
                "pointSize": round(data["m_FaceInfo"]["m_PointSize"]),
                "glyphs": len(glyphs),
                "sourceSha256": None,
                "metricEvidence": "serialized-static-fontasset",
            })
            continue
        if source_obj is None or source_obj.type.name != "Font":
            raise RuntimeError(f"FontAsset {font_id} source Font object is invalid")
        source = source_obj.read()
        source_bytes = bytes(source.m_FontData)
        expected_source = expected_fonts[font_id].get("source", {})
        if sha256(source_bytes) != expected_source.get("sha256"):
            raise RuntimeError(f"FontAsset {font_id} source OTF hash drifted")

        with tempfile.NamedTemporaryFile(suffix=".otf", delete=False) as handle:
            handle.write(source_bytes)
            temp_name = handle.name
        try:
            face = freetype.Face(temp_name)
            point_size = round(data["m_FaceInfo"]["m_PointSize"])
            face.set_pixel_sizes(0, point_size)
            font_checked = 0
            for glyph in data.get("m_GlyphTable", []):
                glyph_index = int(glyph["m_Index"])
                face.load_glyph(glyph_index, NO_HINT_FLAGS)
                source_metrics = metric_values(face.glyph.metrics)
                official_metrics = serialized_values(glyph["m_Metrics"])
                differences = {
                    key: (source_metrics[key], official_metrics[key])
                    for key in source_metrics
                    if source_metrics[key] != official_metrics[key]
                }
                checked += 1
                font_checked += 1
                if not differences:
                    exact += 1
                    continue
                override = SERIALIZED_OVERRIDES.get((font_id, glyph_index))
                if override is None or differences != {
                    override["field"]: (override["source"], override["serialized"]),
                }:
                    raise RuntimeError(
                        f"unexpected glyph metric mismatch font={font_id} glyph={glyph_index}: {differences}"
                    )
                observed_overrides[(font_id, glyph_index)] = differences
            font_rows.append({
                "fontId": font_id,
                "name": data.get("m_Name"),
                "pointSize": point_size,
                "glyphs": font_checked,
                "sourceSha256": sha256(source_bytes),
                "metricEvidence": "source-otf-no-hinting",
            })
        finally:
            os.unlink(temp_name)

    missing_overrides = set(SERIALIZED_OVERRIDES) - set(observed_overrides)
    if missing_overrides:
        raise RuntimeError(f"pinned serialized glyph overrides were not observed: {sorted(missing_overrides)}")

    report = {
        "schemaVersion": 1,
        "unityVersion": "2022.3.62f2",
        "renderMode": "SDFAA/no-hinting",
        "freetypeVersion": ".".join(str(value) for value in freetype.version()),
        "fontAssets": len(font_rows),
        "glyphsChecked": checked,
        "sourceExactGlyphs": exact,
        "serializedOverrides": len(observed_overrides),
        "staticSerializedGlyphs": static_serialized,
        "fonts": font_rows,
    }
    if "--json" in os.sys.argv:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print("Official TMP glyph metrics OK")
        print(f"FontAssets: {len(font_rows)}")
        print(f"Source glyphs: {checked} ({exact} source-exact, {len(observed_overrides)} pinned serialized override)")
        print(f"Static FontAsset glyphs: {static_serialized} serialized and object-hash pinned")
        print(f"FreeType: {report['freetypeVersion']} / FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP")


if __name__ == "__main__":
    main()
