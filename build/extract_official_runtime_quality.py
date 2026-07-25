#!/usr/bin/env python3
"""Extract only the official game's persisted Quality/Fps values.

The encrypted preference payload is never written or emitted.  The decoder is
derived from pinned PTCGP 1.6.0 IL2CPP and metadata bytes, and the JSON output
contains only provenance, hashes, structural validation, and the two approved
keys.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LIBIL2CPP = Path(
    os.environ.get(
        "PCR_LIBIL2CPP",
        ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "libil2cpp.so",
    )
)
DEFAULT_METADATA = Path(
    os.environ.get(
        "PCR_GLOBAL_METADATA",
        ROOT.parent / "ptcg-apk-parser" / "apks" / "output" / "global-metadata.dat",
    )
)
DEFAULT_ADB = Path(
    os.environ.get("PCR_BLUESTACKS_ADB", r"C:/Program Files/BlueStacks_nxt/HD-Adb.exe")
)
DEFAULT_SERIAL = os.environ.get("PCR_ANDROID_SERIAL", "127.0.0.1:5555")
PACKAGE = "jp.pokemon.pokemontcgp"
PREF_PATH = f"/data/data/{PACKAGE}/files/UserPreferences/v1/SystemUserPrefs"

EXPECTED_LIBIL2CPP = (128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e")
EXPECTED_METADATA = (31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9")
EXPECTED_PACKAGE = {"versionName": "1.6.0", "versionCode": 293311}
EXPECTED_CONSTANTS = {
    "key": (0x10FFDB0, 32, "42c43af4f4399b90f8af4a41153883f06746070e95c64f344b55342c9a4788f4"),
    "turns": (0x1101C00, 16, "8d33c836063c4f870c3c08f668ba99e12cb43f5c258dbd687e5a46de9e1b794b"),
    "sigma": (0x1101C18, 16, "d93920a685aab16b74fca9bf5e5c5b844995ccb5394f261a91d847bec62580bc"),
}
EXPECTED_METHODS = {
    "LtUserPrefs.GenerateEncryptRandomSeed": (0x473DD48, 8, "aca8e1b7b4e8eb22e46e44679e94319714478d6f3807b3e93ce801ebd7be8b78"),
    "LtUserPrefsVersions.cctor": (0x4744958, 232, "d8dd69d73ae1ec6cec0a26e159edd7e0f547ae7c2b5627b14b0c087957b6e9bc"),
    "EncryptedPreferenceFile.Read": (0x585D9C8, 1976, "cd3a1f2c143dff3706d2bd55cd37b4fe071b8e5ec25b5c36fe1c62a3202b15d4"),
    "EncryptedPreferenceFile.Write": (0x585E180, 1768, "390cbcf50830f1a8b305146d4b0485f52e2858592822c673491eee0a5028ff14"),
    "Acpb.Create": (0x30C29E8, 264, "8d3188150fc2ee3d862849f49f89a594d0dc130da26820761960d8fda771bc50"),
    "Acpb.ctor": (0x30C2AF0, 436, "4e44a9de0bc2ab7a7edc85f1c45d40b52d86e2e256a136192fc7df8acb6e19eb"),
    "Acpb.TransformStatic.BurstManaged": (0x30C3420, 1568, "58c0163fddac72c2eb2d97d59ac5bae8d19c83da2b890ce3ba950b249c31d93d"),
}
QUALITY_NAMES = {0: "High", 1: "Middle", 2: "Low"}
APPROVED_KEYS = {"ConfigSystem/Quality", "ConfigSystem/Fps"}
MASK32 = 0xFFFFFFFF


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Elf64:
    def __init__(self, data: bytes):
        if data[:6] != b"\x7fELF\x02\x01":
            raise ValueError("libil2cpp is not little-endian ELF64")
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
        self.data = data
        self.loads: list[tuple[int, int, int]] = []
        for index in range(phnum):
            offset = phoff + index * phentsize
            if struct.unpack_from("<I", data, offset)[0] != 1:
                continue
            file_offset, virtual_address = struct.unpack_from("<QQ", data, offset + 8)
            file_size = struct.unpack_from("<Q", data, offset + 32)[0]
            self.loads.append((virtual_address, file_offset, file_size))

    def range(self, rva: int, size: int) -> bytes:
        for virtual_address, file_offset, file_size in self.loads:
            if virtual_address <= rva and rva + size <= virtual_address + file_size:
                start = file_offset + rva - virtual_address
                return self.data[start : start + size]
        raise ValueError(f"RVA 0x{rva:x}+{size} is not file-backed")


def run_adb(adb: Path, serial: str, *args: str, binary: bool = False) -> bytes | str:
    result = subprocess.run(
        [str(adb), "-s", serial, *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=not binary,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", "replace") if binary else result.stderr
        raise RuntimeError(f"ADB failed: {stderr.strip()}")
    return result.stdout


def read_runtime_source(args: argparse.Namespace) -> tuple[bytes, dict[str, object]]:
    if args.input:
        raw = args.input.read_bytes()
        return raw, {
            "kind": "offline-file",
            "serial": None,
            "package": PACKAGE,
            "versionName": args.version_name,
            "versionCode": args.version_code,
            "androidRelease": None,
            "systemAbi": None,
            "rootVerified": False,
        }

    if not args.adb.is_file():
        raise FileNotFoundError(f"BlueStacks ADB not found: {args.adb}")
    root_id = str(run_adb(args.adb, args.serial, "shell", "su", "-c", "id")).strip()
    if "uid=0(root)" not in root_id:
        raise RuntimeError("target ADB device did not grant read-only root access")
    package_dump = str(run_adb(args.adb, args.serial, "shell", "dumpsys", "package", PACKAGE))
    name_match = re.search(r"\bversionName=([^\s]+)", package_dump)
    code_match = re.search(r"\bversionCode=(\d+)", package_dump)
    if not name_match or not code_match:
        raise RuntimeError("could not identify installed game version")
    raw = run_adb(
        args.adb,
        args.serial,
        "exec-out",
        "su",
        "-c",
        f"cat {PREF_PATH}",
        binary=True,
    )
    return bytes(raw), {
        "kind": "live-bluestacks-adb",
        "serial": args.serial,
        "package": PACKAGE,
        "versionName": name_match.group(1),
        "versionCode": int(code_match.group(1)),
        "androidRelease": str(run_adb(args.adb, args.serial, "shell", "getprop", "ro.build.version.release")).strip(),
        "systemAbi": str(run_adb(args.adb, args.serial, "shell", "getprop", "ro.product.cpu.abi")).strip(),
        "rootVerified": True,
    }


def rotl32(value: int, shift: int) -> int:
    return ((value << shift) & MASK32) | (value >> (32 - shift))


def quarter_round(state: list[int], a: int, b: int, c: int, d: int) -> None:
    state[a] = (state[a] + state[b]) & MASK32
    state[d] = rotl32(state[d] ^ state[a], 16)
    state[c] = (state[c] + state[d]) & MASK32
    state[b] = rotl32(state[b] ^ state[c], 12)
    state[a] = (state[a] + state[b]) & MASK32
    state[d] = rotl32(state[d] ^ state[a], 8)
    state[c] = (state[c] + state[d]) & MASK32
    state[b] = rotl32(state[b] ^ state[c], 7)


def decrypt_preference(raw: bytes, key: bytes, sigma: bytes, turns: bytes) -> tuple[bytes, dict[str, int]]:
    if len(raw) < 17 or raw[:4] != b"EPFL":
        raise ValueError("encrypted preference header/length is invalid")
    nonce = struct.unpack_from("<Q", raw, 4)[0]
    nonce_fill = struct.unpack_from("<I", raw, 12)[0]
    key_words = list(struct.unpack("<8I", key))
    nonce_words = [nonce & MASK32, nonce >> 32, nonce_fill]
    selector_value = ((key_words[5] + key_words[0]) & MASK32) ^ key_words[7]
    selector_value = (
        selector_value
        + ((((nonce_words[0] + nonce_words[1]) & MASK32) ^ nonce_words[2]))
    ) & MASK32
    selector = (
        ((selector_value >> 2) & 1)
        | ((selector_value >> 7) & 2)
        | ((selector_value >> 13) & 4)
        | ((selector_value >> 2) & 8)
    )
    double_rounds = turns[selector]
    if double_rounds not in (5, 6):
        raise ValueError("official Acpb round table selected an invalid value")
    base = list(struct.unpack("<4I", sigma)) + key_words + [0] + nonce_words
    plaintext = bytearray()
    ciphertext = raw[16:]
    for counter, offset in enumerate(range(0, len(ciphertext), 64), start=1):
        initial = base.copy()
        initial[12] = counter & MASK32
        state = initial.copy()
        for _ in range(double_rounds):
            for indices in (
                (0, 4, 8, 12), (1, 5, 9, 13), (2, 6, 10, 14), (3, 7, 11, 15),
                (0, 5, 10, 15), (1, 6, 11, 12), (2, 7, 8, 13), (3, 4, 9, 14),
            ):
                quarter_round(state, *indices)
        stream = b"".join(
            struct.pack("<I", (state[index] + initial[index]) & MASK32)
            for index in range(16)
        )
        chunk = ciphertext[offset : offset + 64]
        plaintext.extend(left ^ right for left, right in zip(chunk, stream))
    return bytes(plaintext), {"roundSelector": selector, "doubleRounds": double_rounds}


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data) and shift <= 63:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
    raise ValueError("truncated/oversized protobuf varint")


def skip_field(data: bytes, offset: int, wire_type: int) -> int:
    if wire_type == 0:
        return read_varint(data, offset)[1]
    if wire_type == 1:
        return offset + 8
    if wire_type == 2:
        size, offset = read_varint(data, offset)
        return offset + size
    if wire_type == 5:
        return offset + 4
    raise ValueError(f"unsupported protobuf wire type {wire_type}")


def parse_int_map_entry(data: bytes) -> tuple[str | None, int | None]:
    offset = 0
    key = None
    value = None
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field, wire_type = tag >> 3, tag & 7
        if field == 1 and wire_type == 2:
            size, offset = read_varint(data, offset)
            key = data[offset : offset + size].decode("utf-8")
            offset += size
        elif field == 2 and wire_type == 0:
            value, offset = read_varint(data, offset)
            if value >= 1 << 31:
                value -= 1 << 32
        else:
            offset = skip_field(data, offset, wire_type)
        if offset > len(data):
            raise ValueError("protobuf map entry exceeds payload")
    return key, value


def parse_approved_values(data: bytes) -> tuple[dict[str, int], dict[str, int]]:
    offset = 0
    int_count = 0
    approved: dict[str, int] = {}
    field_counts: dict[str, int] = {}
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field, wire_type = tag >> 3, tag & 7
        field_counts[str(field)] = field_counts.get(str(field), 0) + 1
        if wire_type != 2:
            offset = skip_field(data, offset, wire_type)
            continue
        size, offset = read_varint(data, offset)
        end = offset + size
        if end > len(data):
            raise ValueError("protobuf field exceeds payload")
        if field == 2:
            key, value = parse_int_map_entry(data[offset:end])
            int_count += 1
            if key in APPROVED_KEYS and value is not None:
                approved[key] = value
        offset = end
    return approved, {"byteSize": len(data), "intEntryCount": int_count, "fieldCounts": field_counts}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, default=DEFAULT_ADB)
    parser.add_argument("--serial", default=DEFAULT_SERIAL)
    parser.add_argument("--libil2cpp", type=Path, default=DEFAULT_LIBIL2CPP)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--version-name", default=EXPECTED_PACKAGE["versionName"])
    parser.add_argument("--version-code", type=int, default=EXPECTED_PACKAGE["versionCode"])
    args = parser.parse_args()

    lib_bytes = args.libil2cpp.read_bytes()
    metadata = args.metadata.read_bytes()
    if (len(lib_bytes), sha256(lib_bytes)) != EXPECTED_LIBIL2CPP:
        raise ValueError("official 1.6.0 libil2cpp identity drifted")
    if (len(metadata), sha256(metadata)) != EXPECTED_METADATA:
        raise ValueError("official 1.6.0 global metadata identity drifted")
    elf = Elf64(lib_bytes)
    methods = {}
    for name, (rva, size, expected_hash) in EXPECTED_METHODS.items():
        method_bytes = elf.range(rva, size)
        actual_hash = sha256(method_bytes)
        if actual_hash != expected_hash:
            raise ValueError(f"{name} method bytes drifted")
        methods[name] = {"rva": f"0x{rva:x}", "byteSize": size, "sha256": actual_hash}

    constants = {}
    constant_bytes = {}
    for name, (offset, size, expected_hash) in EXPECTED_CONSTANTS.items():
        value = metadata[offset : offset + size]
        actual_hash = sha256(value)
        if len(value) != size or actual_hash != expected_hash:
            raise ValueError(f"{name} metadata constant drifted")
        constant_bytes[name] = value
        constants[name] = {"metadataOffset": f"0x{offset:x}", "byteSize": size, "sha256": actual_hash}

    raw, target = read_runtime_source(args)
    if target["versionName"] != EXPECTED_PACKAGE["versionName"] or target["versionCode"] != EXPECTED_PACKAGE["versionCode"]:
        raise ValueError("installed game is not the pinned PTCGP 1.6.0 sample")
    plaintext, cipher = decrypt_preference(
        raw,
        constant_bytes["key"],
        constant_bytes["sigma"],
        constant_bytes["turns"],
    )
    approved, protobuf = parse_approved_values(plaintext)
    quality_enum = approved.get("ConfigSystem/Quality")
    if quality_enum is not None and quality_enum not in QUALITY_NAMES:
        raise ValueError(f"persisted quality enum {quality_enum} is outside the official range")

    report = {
        "schemaVersion": 1,
        "status": "exact-runtime-preference",
        "evidencePolicy": {
            "officialOnly": True,
            "readInputs": ["PTCGP 1.6.0 libil2cpp.so", "PTCGP 1.6.0 global-metadata.dat", "live encrypted SystemUserPrefs"],
            "emittedPreferenceKeys": sorted(APPROVED_KEYS),
            "rawPreferenceBytesEmitted": False,
            "decryptedPreferenceBytesEmitted": False,
        },
        "officialSource": {
            "libil2cpp": {"byteSize": len(lib_bytes), "sha256": sha256(lib_bytes)},
            "metadata": {"byteSize": len(metadata), "sha256": sha256(metadata)},
            "methods": methods,
            "constants": constants,
        },
        "target": target,
        "preferenceFile": {
            "path": PREF_PATH,
            "byteSize": len(raw),
            "sha256": sha256(raw),
            "headerHex": raw[:4].hex(),
            "layout": {"headerBytes": 4, "nonceBytes": 8, "nonceFillBytes": 4, "ciphertextOffset": 16},
        },
        "cipher": {
            "name": "Aladin.Crypto.Acpb / ChaCha20BurstStream",
            "counterInitial": [1, 2, 3, 4],
            "counterIncremental": [4, 4, 4, 4],
            **cipher,
        },
        "protobuf": {**protobuf, "fullyConsumed": True},
        "runtime": {
            "quality": {
                "key": "ConfigSystem/Quality",
                "persisted": quality_enum is not None,
                "enum": quality_enum,
                "name": QUALITY_NAMES.get(quality_enum),
            },
            "fps": {
                "key": "ConfigSystem/Fps",
                "persisted": "ConfigSystem/Fps" in approved,
                "enum": approved.get("ConfigSystem/Fps"),
            },
        },
    }
    json.dump(report, sys.stdout, indent=2, ensure_ascii=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"runtime quality extraction failed: {error}", file=sys.stderr)
        raise SystemExit(1)
