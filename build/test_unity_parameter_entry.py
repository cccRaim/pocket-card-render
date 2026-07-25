#!/usr/bin/env python3
"""Mutation tests for the shared Unity serialized parameter-entry parser."""
from __future__ import annotations

import hashlib
from pathlib import Path
import struct

from shaderdec.unity_parameter_entry import parse_parameter_entry

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "$cache" / "selector-ur-plate" / "ur_plate_parameter.bin"
EXPECTED_SHA256 = "5d6f5dc43175ca98722fadde0cbafe7b27013e96e3c00f07cf43b5657af905dd"


def must_fail(data: bytes) -> None:
    try:
        parse_parameter_entry(data, set())
    except (ValueError, UnicodeDecodeError, struct.error):
        return
    raise AssertionError("mutated parameter entry was accepted")


raw = SAMPLE.read_bytes()
assert len(raw) == 92
assert hashlib.sha256(raw).hexdigest() == EXPECTED_SHA256
assert parse_parameter_entry(raw, set()) == {
    "version": 202012090,
    "constantBlockCount": 3,
    "constantBuffers": [
        {"name": "", "size": 0, "fields": []},
        {"name": "PGlobals33246651", "size": 224, "fields": []},
        {"name": "VGlobals33246651", "size": 248, "fields": []},
    ],
    "resourceCount": 0,
    "resourceDecoding": "empty-exact",
    "textures": [],
    "constantBufferBindings": [],
}

mutated = bytearray(raw)
struct.pack_into("<I", mutated, 0, 0)
must_fail(bytes(mutated))
mutated = bytearray(raw)
struct.pack_into("<I", mutated, 4, 2)
must_fail(bytes(mutated))
mutated = bytearray(raw)
struct.pack_into("<I", mutated, 20, 1)
must_fail(bytes(mutated))
must_fail(raw + b"\0\0\0\0")

print("Unity parameter-entry parser mutation tests OK: block-count layout and strict EOF")
