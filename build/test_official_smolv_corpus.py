#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import struct
import sys

import UnityPy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))
sys.path.insert(0, str(ROOT / "build" / "shaderdec"))

import audit_official_smolv_corpus as audit  # noqa: E402
import extract_official_material_program_inventory as inventory  # noqa: E402


def rejects(callback, label: str) -> None:
    try:
        callback()
    except RuntimeError:
        return
    raise AssertionError(f"mutation was accepted: {label}")


decrypted_root = Path(os.environ.get("PCR_DECRYPTED_ROOT", inventory.DEFAULT_DECRYPTED_ROOT))
fixture_path = (
    decrypted_root
    / "Common"
    / "Shader"
    / "Common"
    / "CardNew"
    / "Card_Shadow.shader_bundles"
)
environment = UnityPy.load(str(fixture_path))
shader_object = [obj for obj in environment.objects if obj.type.name == "Shader"]
assert len(shader_object) == 1
shader = shader_object[0].read_typetree()
entries = inventory.shader_program_segments(shader)[0]["entries"]
programs, parameters = audit.shader_blob_references(shader, len(entries))
assert len(programs) == 2
assert len(parameters) == 2

raw = entries[2]["raw"]
records = audit.strict_program_records(raw, "Card_Shadow/entry2")
assert [(row["offset"], len(row["compressed"]), row["stage"]) for row in records] == [
    (208, 473, "fragment"),
    (681, 684, "vertex"),
]
assert records[0]["containerLayoutSha256"] == (
    "c34e817954230a4d8b61b9f7433ee22e0b6ddae3e29da2027adef0bb3ea962a5"
)

missing_magic = bytearray(raw)
missing_magic[records[0]["offset"]] ^= 0x01
rejects(lambda: audit.strict_program_records(bytes(missing_magic), "missing-magic"), "missing magic")

second_end = records[1]["offset"] + len(records[1]["compressed"])
rejects(lambda: audit.strict_program_records(raw[: second_end - 1], "truncated"), "truncated record")

gap_offset = records[1]["offset"]
with_gap = raw[:gap_offset] + b"\x00" + raw[gap_offset:]
rejects(lambda: audit.strict_program_records(with_gap, "module-gap"), "module gap")

bad_size = bytearray(raw)
struct.pack_into("<I", bad_size, records[1]["offset"] + 20, 21)
rejects(lambda: audit.strict_program_records(bytes(bad_size), "decoded-size"), "decoded size")

print("Official SMOL-V corpus mutation tests: PASS")
print("  official container prefix/suffix fixture locked")
print("  missing magic, truncation, module gap, and decoded-size mutations rejected")
