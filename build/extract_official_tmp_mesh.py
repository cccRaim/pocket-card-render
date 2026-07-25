#!/usr/bin/env python3
"""Extract byte-level TMP mesh packing evidence from the official IL2CPP image."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN


ROOT = Path(__file__).resolve().parents[1]
IL2CPP = Path(os.environ.get(
    "PCR_IL2CPP",
    ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "libil2cpp.so",
))
SETTINGS_CONTRACT = ROOT / "public" / "render" / "tmp-settings-contract.json"
LAYOUT_CONTRACT = ROOT / "public" / "render" / "card-ui-layout-contract.json"
TMP_PACKAGE = Path(os.environ.get(
    "PCR_TMP_PACKAGE",
    "C:/Users/Admin/AppData/Local/Temp/tmp-3.0.6/package",
))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_range(lines: list[str], start_line: int, end_line: int) -> dict:
    payload = ("\n".join(lines[start_line - 1:end_line]) + "\n").encode("utf-8")
    return {"startLine": start_line, "endLine": end_line, "sha256": sha256(payload)}


def collect_tmp_components(layout: dict) -> list[dict]:
    rows = []

    def walk(node: dict, kind: str) -> None:
        if node.get("tmp"):
            rows.append({"kind": kind, **node["tmp"]})
        for child in node.get("children", []):
            walk(child, kind)

    for prefab in layout.get("prefabs", []):
        for root in prefab.get("roots", []):
            walk(root, prefab["kind"])
    return rows


def histogram(rows: list[dict], key: str) -> dict:
    output = {}
    for row in rows:
        value = str(row.get(key))
        output[value] = output.get(value, 0) + 1
    return dict(sorted(output.items(), key=lambda item: float(item[0])))


class Elf64:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.data = path.read_bytes()
        if self.data[:6] != b"\x7fELF\x02\x01":
            raise RuntimeError(f"{path}: expected ELF64 little-endian")
        phoff = struct.unpack_from("<Q", self.data, 0x20)[0]
        entsize = struct.unpack_from("<H", self.data, 0x36)[0]
        count = struct.unpack_from("<H", self.data, 0x38)[0]
        self.loads = []
        for index in range(count):
            values = struct.unpack_from("<IIQQQQQQ", self.data, phoff + index * entsize)
            if values[0] == 1:
                self.loads.append({"offset": values[2], "vaddr": values[3], "filesz": values[5]})

    def offset(self, rva: int) -> int:
        for segment in self.loads:
            if segment["vaddr"] <= rva < segment["vaddr"] + segment["filesz"]:
                return segment["offset"] + rva - segment["vaddr"]
        raise RuntimeError(f"RVA is not file-backed: {rva:#x}")

    def range(self, start: int, end: int) -> bytes:
        return self.data[self.offset(start):self.offset(end)]


def disassemble(elf: Elf64, start: int, end: int) -> list[dict]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    return [
        {"address": f"0x{ins.address:x}", "mnemonic": ins.mnemonic, "operands": ins.op_str}
        for ins in decoder.disasm(elf.range(start, end), start)
    ]


def main() -> None:
    elf = Elf64(IL2CPP)
    settings = json.loads(SETTINGS_CONTRACT.read_text(encoding="utf-8"))
    layout_bytes = LAYOUT_CONTRACT.read_bytes()
    layout = json.loads(layout_bytes)
    rows = collect_tmp_components(layout)
    ugui_record = settings["source"]["textMeshProPackage"]["uguiGenerator"]
    if ugui_record["path"] != (
        "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMPro_UGUI_Private.cs"
    ):
        raise RuntimeError("unexpected logical TMP UGUI source path")
    ugui_path = TMP_PACKAGE / "Scripts" / "Runtime" / "TMPro_UGUI_Private.cs"
    ugui_bytes = ugui_path.read_bytes()
    if sha256(ugui_bytes) != ugui_record["sha256"]:
        raise RuntimeError("TMP UGUI source hash drifted")
    ugui_lines = ugui_bytes.decode("utf-8").splitlines()
    methods = {
        "tmpTextPackUvVector2": (0x648ED90, 0x648EDE8),
        "tmpTextPackUvFloat": (0x648FE30, 0x648FE90),
        "tmpTextUtilitiesPackUvVector2": (0x65AD424, 0x65AD47C),
    }
    blocks = {
        "uguiPackedUvWrites": (0x6454CA0, 0x6454DA4),
        "uguiStyleAndScaleLoads": (0x64554C0, 0x6455524),
    }
    method_bodies = {
        "textMeshProUguiGenerateTextMesh": (0x644F2F8, 0x6466270),
    }
    constant = elf.range(0x1AF8E1C, 0x1AF8E20)
    report = {
        "schemaVersion": 2,
        "source": {
            "path": str(elf.path),
            "byteSize": len(elf.data),
            "sha256": sha256(elf.data),
            "gameVersion": "1.6.0",
            "unityVersion": "2022.3.62f2",
        },
        "packUvConstant": {
            "rva": "0x1af8e1c",
            "bytes": constant.hex(),
            "float32": struct.unpack("<f", constant)[0],
        },
        "methods": {},
        "meshBlocks": {},
        "methodBodies": {},
        "textMeshProSource": {
            "version": "3.0.6",
            "path": str(ugui_path.resolve()),
            "byteSize": len(ugui_bytes),
            "sha256": sha256(ugui_bytes),
            "nativeGenerateTextMesh": settings["native"]["generateTextMesh"],
            "ranges": {
                "baseScale": source_range(ugui_lines, 1727, 1731),
                "characterScale": source_range(ugui_lines, 2092, 2108),
                "characterQuadAndItalic": source_range(ugui_lines, 2239, 2282),
                "characterAdvance": source_range(ugui_lines, 3218, 3250),
                "packedUvScale": source_range(ugui_lines, 3887, 3891),
            },
        },
        "reachableCardUi": {
            "contractSha256": sha256(layout_bytes),
            "tmpComponentCount": len(rows),
            "fontStyle": histogram(rows, "m_fontStyle"),
            "fontWeight": histogram(rows, "m_fontWeight"),
            "orthographic": histogram(rows, "m_isOrthographic"),
            "rightToLeft": histogram(rows, "m_isRightToLeft"),
            "extraPadding": histogram(rows, "m_enableExtraPadding"),
            "geometrySortingOrder": histogram(rows, "m_geometrySortingOrder"),
        },
        "facts": {
            "packUvFormula": "trunc(x * 511) * 4096 + trunc(y * 511)",
            "vector2SecondComponent": "scale",
            "characterInfoStride": "0x178",
            "characterInfoAlternateTypefaceOffset": "0x3c",
            "characterInfoScaleOffset": "0x140",
            "characterInfoStyleOffset": "0x170",
            "uguiPackUvCallCount": 4,
        },
    }
    for name, (start, end) in methods.items():
        payload = elf.range(start, end)
        report["methods"][name] = {
            "startRva": f"0x{start:x}",
            "endRva": f"0x{end:x}",
            "byteSize": len(payload),
            "sha256": sha256(payload),
            "instructions": disassemble(elf, start, end),
        }
    for name, (start, end) in blocks.items():
        payload = elf.range(start, end)
        report["meshBlocks"][name] = {
            "startRva": f"0x{start:x}",
            "endRva": f"0x{end:x}",
            "byteSize": len(payload),
            "sha256": sha256(payload),
            "instructions": disassemble(elf, start, end),
        }
    for name, (start, end) in method_bodies.items():
        payload = elf.range(start, end)
        report["methodBodies"][name] = {
            "startRva": f"0x{start:x}",
            "endRva": f"0x{end:x}",
            "byteSize": len(payload),
            "sha256": sha256(payload),
        }
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
