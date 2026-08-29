#!/usr/bin/env python3
"""Extract and verify the candidate encrypted-metadata derivation proof."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import zipfile

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from Crypto.Cipher import AES
from Crypto.Util import Counter

from official_sample import load_official_sample


EXPECTED_SAMPLE_ID = "ptcgp-1.7.0-unity-6000.0.69f1-candidate"
EXPECTED_UNITY_VERSION = "6000.0.69f1"
METADATA_ENTRY = "assets/bin/Data/Managed/Metadata/global-metadata.dat"
LIBIL2CPP_ENTRY = "lib/arm64-v8a/libil2cpp.so"
METADATA_MAGIC = 0xFAB11BAF
METADATA_VERSION = 31
METADATA_HEADER_SIZE = 0x100
METADATA_TABLE_COUNT = 31

# Candidate-specific locator seeds. Values used by the transformation are
# extracted from operands/data reached from these roots, not copied from a
# plaintext file or accepted as free-standing constants.
FUNCTION_RANGES = {
    "Aes128KeySchedule": (0x3259C58, 0x3259EF4),
    "Aes128EncryptBlock": (0x3259EF4, 0x325A840),
    "MetadataDecryptor": (0x325A8D0, 0x325AB30),
    "CtrStreamReader": (0x325AB30, 0x325ACD0),
    "CounterIncrement": (0x325ACD0, 0x325AE48),
    "AesKeySetup": (0x325AEC4, 0x325AF64),
    "MetadataLoadCaller": (0x326341C, 0x326358C),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def identity(data: bytes) -> dict:
    return {"byteLength": len(data), "sha256": sha256(data)}


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return sha256(encoded)


def verify_identity(label: str, data: bytes, expected: dict) -> None:
    actual = identity(data)
    wanted = {
        "byteLength": expected["byteLength"],
        "sha256": expected["sha256"],
    }
    if actual != wanted:
        raise ValueError(f"{label} identity mismatch: {actual} != {wanted}")


class Elf64:
    def __init__(self, data: bytes):
        if (
            len(data) < 0x40
            or data[:4] != b"\x7fELF"
            or data[4] != 2
            or data[5] != 1
        ):
            raise ValueError("libil2cpp is not a little-endian ELF64 image")
        if struct.unpack_from("<H", data, 0x12)[0] != 0xB7:
            raise ValueError("libil2cpp is not an AArch64 ELF image")
        self.data = data
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
        if phentsize < 56 or phoff + phentsize * phnum > len(data):
            raise ValueError("libil2cpp program-header table is invalid")
        self.loads: list[tuple[int, int, int]] = []
        for index in range(phnum):
            cursor = phoff + index * phentsize
            if struct.unpack_from("<I", data, cursor)[0] != 1:
                continue
            file_offset, virtual_address, _physical, file_size = (
                struct.unpack_from("<QQQQ", data, cursor + 8)
            )
            if file_offset + file_size > len(data):
                raise ValueError("libil2cpp PT_LOAD range exceeds the file")
            self.loads.append((virtual_address, file_offset, file_size))
        if not self.loads:
            raise ValueError("libil2cpp has no file-backed PT_LOAD ranges")

    def offset(self, rva: int, size: int = 1) -> int:
        for virtual_address, file_offset, file_size in self.loads:
            relative = rva - virtual_address
            if 0 <= relative and relative + size <= file_size:
                return file_offset + relative
        raise ValueError(f"RVA 0x{rva:x} (+0x{size:x}) is not file-backed")

    def range(self, start: int, end: int) -> bytes:
        if end <= start:
            raise ValueError("invalid ELF range")
        offset = self.offset(start, end - start)
        return self.data[offset : offset + end - start]

    def mutate_rva(self, rva: int, mask: int = 1) -> bytes:
        mutated = bytearray(self.data)
        mutated[self.offset(rva)] ^= mask
        return bytes(mutated)


class Arm64Evidence:
    def __init__(self, elf: Elf64):
        self.elf = elf
        self.disassembler = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
        self.checks: list[dict] = []

    def instruction(self, rva: int):
        raw = self.elf.range(rva, rva + 4)
        decoded = list(self.disassembler.disasm(raw, rva))
        if len(decoded) != 1 or decoded[0].address != rva:
            raise ValueError(f"could not decode one ARM64 instruction at 0x{rva:x}")
        return decoded[0]

    def expect(
        self,
        label: str,
        rva: int,
        mnemonic: str,
        operand_pattern: str,
    ):
        instruction = self.instruction(rva)
        if instruction.mnemonic != mnemonic or re.fullmatch(
            operand_pattern, instruction.op_str
        ) is None:
            raise ValueError(
                f"{label} changed at 0x{rva:x}: "
                f"{instruction.mnemonic} {instruction.op_str}"
            )
        raw = bytes(instruction.bytes)
        self.checks.append(
            {
                "label": label,
                "rva": f"0x{rva:x}",
                "bytesHex": raw.hex(),
                "sha256": sha256(raw),
                "instruction": f"{instruction.mnemonic} {instruction.op_str}",
            }
        )
        return instruction


def immediate(op_str: str, *, index: int = -1) -> int:
    matches = re.findall(r"#(?:0x([0-9a-f]+)|([0-9]+))", op_str)
    if not matches:
        raise ValueError(f"instruction has no immediate operand: {op_str}")
    hex_value, decimal_value = matches[index]
    return int(hex_value, 16) if hex_value else int(decimal_value)


def referenced_rva(
    evidence: Arm64Evidence,
    label: str,
    adrp_rva: int,
    add_rva: int,
    register: str,
) -> int:
    page = evidence.expect(
        f"{label} page",
        adrp_rva,
        "adrp",
        rf"{register}, #0x[0-9a-f]+",
    )
    offset = evidence.expect(
        f"{label} offset",
        add_rva,
        "add",
        rf"{register}, {register}, #0x[0-9a-f]+",
    )
    return immediate(page.op_str) + immediate(offset.op_str)


def extract_key8(evidence: Arm64Evidence) -> int:
    parts = [
        evidence.expect(
            "KEY8 low immediate",
            0x3263564,
            "mov",
            r"x1, #0x[0-9a-f]+",
        ),
        evidence.expect(
            "KEY8 bits 16..31",
            0x326356C,
            "movk",
            r"x1, #0x[0-9a-f]+, lsl #16",
        ),
        evidence.expect(
            "KEY8 bits 32..47",
            0x3263570,
            "movk",
            r"x1, #0x[0-9a-f]+, lsl #32",
        ),
        evidence.expect(
            "KEY8 bits 48..63",
            0x3263574,
            "movk",
            r"x1, #0x[0-9a-f]+, lsl #48",
        ),
    ]
    value = immediate(parts[0].op_str)
    for instruction in parts[1:]:
        shift = immediate(instruction.op_str, index=1)
        value |= immediate(instruction.op_str, index=0) << shift
    call = evidence.expect(
        "metadata decryptor call",
        0x3263578,
        "bl",
        r"#0x[0-9a-f]+",
    )
    if immediate(call.op_str) != FUNCTION_RANGES["MetadataDecryptor"][0]:
        raise ValueError("metadata caller no longer targets the pinned decryptor")
    return value


def aes_sbox() -> bytes:
    def multiply(left: int, right: int) -> int:
        result = 0
        for _ in range(8):
            if right & 1:
                result ^= left
            left = ((left << 1) ^ (0x11B if left & 0x80 else 0)) & 0xFF
            right >>= 1
        return result

    def inverse(value: int) -> int:
        if value == 0:
            return 0
        result = 1
        base = value
        exponent = 254
        while exponent:
            if exponent & 1:
                result = multiply(result, base)
            base = multiply(base, base)
            exponent >>= 1
        return result

    result = bytearray()
    for value in range(256):
        inv = inverse(value)
        transformed = inv
        for shift in (1, 2, 3, 4):
            transformed ^= ((inv << shift) | (inv >> (8 - shift))) & 0xFF
        result.append(transformed ^ 0x63)
    return bytes(result)


def canonical_aes_tables() -> tuple[bytes, list[bytes]]:
    sbox = aes_sbox()

    def mul2(value: int) -> int:
        return ((value << 1) ^ (0x1B if value & 0x80 else 0)) & 0xFF

    tables = [bytearray() for _ in range(4)]
    for value in sbox:
        twice = mul2(value)
        triple = twice ^ value
        rows = (
            (triple, value, value, twice),
            (value, value, twice, triple),
            (value, twice, triple, value),
            (twice, triple, value, value),
        )
        for table, row in zip(tables, rows):
            table.extend(row)
    rcon_values = (1, 2, 4, 8, 16, 32, 64, 128, 27, 54)
    rcon = b"".join(struct.pack(">I", value) for value in rcon_values)
    return rcon, [bytes(table) for table in tables]


def extract_native_contract(libil2cpp: bytes) -> dict:
    elf = Elf64(libil2cpp)
    evidence = Arm64Evidence(elf)

    key8_value = extract_key8(evidence)
    table_rva = referenced_rva(
        evidence, "metadata key table", 0x325A954, 0x325A958, "x9"
    )
    prefix_length_rva = referenced_rva(
        evidence, "embedded prefix length", 0x325A908, 0x325A90C, "x8"
    )
    prefix_base_rva = referenced_rva(
        evidence, "embedded prefix base", 0x325AA54, 0x325AA58, "x9"
    )
    prefix_adjust = evidence.expect(
        "embedded prefix data adjustment",
        0x325AA4C,
        "add",
        r"w8, w8, #0x[0-9a-f]+",
    )
    prefix_rva = prefix_base_rva + immediate(prefix_adjust.op_str)

    evidence.expect(
        "encrypted suffix size header load",
        0x325A8F4,
        "ldr",
        r"w8, \[x8\]",
    )
    evidence.expect(
        "encrypted suffix begins after header",
        0x325A900,
        "add",
        r"x8, x8, #4",
    )
    evidence.expect(
        "key table byte load",
        0x325A960,
        "ldrb",
        r"w8, \[x8\]",
    )
    evidence.expect(
        "KEY8 repeat mask value",
        0x325A968,
        "mov",
        r"w10, #7",
    )
    evidence.expect(
        "KEY8 repeated over eight bytes",
        0x325A96C,
        "and",
        r"w9, w9, w10",
    )
    evidence.expect(
        "key derivation XOR",
        0x325A980,
        "eor",
        r"w8, w8, w9",
    )
    evidence.expect(
        "derived key byte store",
        0x325A990,
        "strb",
        r"w8, \[x9\]",
    )
    evidence.expect(
        "embedded prefix branch threshold",
        0x325AA38,
        "cmp",
        r"w8, w9",
    )
    evidence.expect(
        "embedded prefix plaintext XOR",
        0x325AA74,
        "eor",
        r"w8, w8, w9",
    )
    evidence.expect(
        "suffix plaintext XOR",
        0x325AAD0,
        "eor",
        r"w8, w8, w9",
    )
    key_setup_call = evidence.expect(
        "AES key setup call",
        0x325A9B0,
        "bl",
        r"#0x[0-9a-f]+",
    )
    if immediate(key_setup_call.op_str) != FUNCTION_RANGES["AesKeySetup"][0]:
        raise ValueError("decryptor AES key setup target changed")
    stream_call = evidence.expect(
        "CTR stream read call",
        0x325A9E0,
        "bl",
        r"#0x[0-9a-f]+",
    )
    if immediate(stream_call.op_str) != FUNCTION_RANGES["CtrStreamReader"][0]:
        raise ValueError("decryptor CTR stream target changed")

    evidence.expect(
        "counter state zero initialization",
        0x325A87C,
        "uxtb",
        r"w1, wzr",
    )
    counter_size = evidence.expect(
        "counter state byte size",
        0x325A880,
        "mov",
        r"x2, #0x[0-9a-f]+",
    )
    if immediate(counter_size.op_str) != 16:
        raise ValueError("AES counter state is no longer 16 bytes")
    evidence.expect(
        "counter increment",
        0x325AD7C,
        "add",
        r"x8, x8, #1",
    )
    for index, address in enumerate(
        (0x325AD98, 0x325ADB0, 0x325ADC8, 0x325ADE0,
         0x325ADF8, 0x325AE10, 0x325AE28, 0x325AE3C)
    ):
        evidence.expect(
            f"big-endian counter byte {index} store",
            address,
            "strb",
            rf"w8, \[x9, #0x{0xC8 + index:x}\]",
        )

    rcon_rva = referenced_rva(
        evidence, "AES Rcon table", 0x3259E50, 0x3259E54, "x10"
    )
    aes_table_rvas = [
        referenced_rva(
            evidence,
            f"AES encryption table {index}",
            adrp,
            add,
            "x9",
        )
        for index, (adrp, add) in enumerate(
            (
                (0x325AF90, 0x325AF94),
                (0x325AFCC, 0x325AFD0),
                (0x325B008, 0x325B00C),
                (0x325B040, 0x325B044),
            )
        )
    ]
    evidence.expect(
        "AES-128 ten-round key schedule",
        0x3259ED0,
        "cmp",
        r"w8, #0xa",
    )

    table16 = elf.range(table_rva, table_rva + 16)
    prefix_length = struct.unpack("<I", elf.range(
        prefix_length_rva, prefix_length_rva + 4
    ))[0]
    if prefix_length <= 0 or prefix_length % 16:
        raise ValueError("embedded ciphertext prefix length is not positive/aligned")
    prefix = elf.range(prefix_rva, prefix_rva + prefix_length)
    key8 = key8_value.to_bytes(8, "little")
    key16 = bytes(
        table16[index] ^ key8[index & 7] for index in range(len(table16))
    )
    if len(key16) != 16:
        raise ValueError("derived AES key is not 128 bits")

    expected_rcon, expected_tables = canonical_aes_tables()
    actual_rcon = elf.range(rcon_rva, rcon_rva + len(expected_rcon))
    if actual_rcon != expected_rcon:
        raise ValueError("native AES Rcon table is not canonical AES-128")
    aes_tables = []
    for index, (rva, expected) in enumerate(zip(aes_table_rvas, expected_tables)):
        actual = elf.range(rva, rva + len(expected))
        if actual != expected:
            raise ValueError(f"native AES encryption table {index} is not canonical")
        aes_tables.append(
            {
                "index": index,
                "rva": f"0x{rva:x}",
                **identity(actual),
            }
        )

    kat_key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    kat_plaintext = bytes.fromhex("00112233445566778899aabbccddeeff")
    kat_expected = bytes.fromhex("69c4e0d86a7b0430d8cdb78070b4c55a")
    kat_actual = AES.new(kat_key, AES.MODE_ECB).encrypt(kat_plaintext)
    if kat_actual != kat_expected:
        raise ValueError("AES-128 implementation failed the standard KAT")

    functions = {}
    for name, (start, end) in FUNCTION_RANGES.items():
        body = elf.range(start, end)
        functions[name] = {
            "startRva": f"0x{start:x}",
            "endRva": f"0x{end:x}",
            **identity(body),
        }

    return {
        "status": "exact-candidate-native-transformation-contract",
        "locatorPolicy": (
            "candidate-version RVA seeds locate code only; KEY8, table, prefix "
            "and counter semantics are re-extracted from hash-verified bytes"
        ),
        "functions": functions,
        "selectedInstructionChecks": evidence.checks,
        "profile": {
            "cipher": "AES-128-CTR",
            "keyDerivation": "table16[i] XOR littleEndian(key8)[i & 7]",
            "key8Source": {
                "callerRva": "0x3263564",
                "valueHex": f"{key8_value:016x}",
                "littleEndianBytesHex": key8.hex(),
            },
            "table": {
                "rva": f"0x{table_rva:x}",
                "bytesHex": table16.hex(),
                **identity(table16),
            },
            "derivedKey": {
                "bytesHex": key16.hex(),
                "ascii": (
                    key16.decode("ascii")
                    if all(0x20 <= value < 0x7F for value in key16)
                    else None
                ),
                **identity(key16),
            },
            "embeddedCiphertextPrefix": {
                "lengthRva": f"0x{prefix_length_rva:x}",
                "rva": f"0x{prefix_rva:x}",
                **identity(prefix),
            },
            "counter": {
                "initialStateHex": "00" * 16,
                "incrementBeforeEncrypt": True,
                "incrementedField": "bytes[8:16] as big-endian uint64",
                "firstCounterBlockHex": (b"\0" * 8 + (1).to_bytes(8, "big")).hex(),
            },
        },
        "aesEvidence": {
            "algorithm": "AES-128 encryption",
            "rcon": {"rva": f"0x{rcon_rva:x}", **identity(actual_rcon)},
            "encryptionTables": aes_tables,
            "standardKnownAnswerTest": {
                "keyHex": kat_key.hex(),
                "plaintextHex": kat_plaintext.hex(),
                "expectedCiphertextHex": kat_expected.hex(),
                "actualCiphertextHex": kat_actual.hex(),
                "passed": True,
            },
        },
        "_runtime": {
            "key16": key16,
            "prefix": prefix,
        },
    }


def transform_metadata(
    encrypted: bytes,
    native: dict,
    expected_plaintext: dict,
) -> tuple[bytes, dict]:
    if len(encrypted) < 4:
        raise ValueError("encrypted metadata is shorter than its size header")
    declared_suffix_length = struct.unpack_from("<I", encrypted)[0]
    suffix = encrypted[4:]
    if declared_suffix_length != len(suffix):
        raise ValueError(
            "encrypted metadata suffix length does not match its header"
        )
    key16 = native["_runtime"]["key16"]
    prefix = native["_runtime"]["prefix"]
    ciphertext = prefix + suffix
    if len(ciphertext) != expected_plaintext["byteLength"]:
        raise ValueError(
            "native prefix plus encrypted suffix does not match expected output length"
        )
    if len(ciphertext) % 16:
        raise ValueError("native decryptor input is not a whole number of AES blocks")
    block_count = len(ciphertext) // 16
    if block_count >= 1 << 64:
        raise ValueError("native uint64 counter would overflow")

    def cipher():
        counter = Counter.new(
            64,
            prefix=b"\0" * 8,
            initial_value=1,
            little_endian=False,
        )
        return AES.new(key16, AES.MODE_CTR, counter=counter)

    plaintext = cipher().decrypt(ciphertext)
    if identity(plaintext) != {
        "byteLength": expected_plaintext["byteLength"],
        "sha256": expected_plaintext["sha256"],
    }:
        raise ValueError("derived plaintext identity does not match the candidate manifest")
    reencryption = cipher().encrypt(plaintext)
    if reencryption != ciphertext:
        raise ValueError("AES-CTR re-encryption does not reproduce ciphertext bytes")

    first_counter = b"\0" * 8 + (1).to_bytes(8, "big")
    first_keystream = AES.new(key16, AES.MODE_ECB).encrypt(first_counter)
    return plaintext, {
        "status": "exact-byte-derivation",
        "encryptedContainer": {
            **identity(encrypted),
            "headerByteLength": 4,
            "declaredSuffixByteLength": declared_suffix_length,
            "suffixSha256": sha256(suffix),
        },
        "reconstructedCiphertext": {
            **identity(ciphertext),
            "composition": "libil2cpp embedded prefix || encrypted[4:]",
            "blockCount": block_count,
            "firstCiphertextBlockHex": ciphertext[:16].hex(),
        },
        "decrypt": {
            "derivedPlaintext": identity(plaintext),
            "firstCounterBlockHex": first_counter.hex(),
            "firstKeystreamBlockHex": first_keystream.hex(),
            "firstPlaintextBlockHex": plaintext[:16].hex(),
        },
        "reencrypt": {
            "byteEqualToReconstructedCiphertext": True,
            **identity(reencryption),
        },
    }


def validate_metadata_v31(plaintext: bytes) -> dict:
    if len(plaintext) < METADATA_HEADER_SIZE:
        raise ValueError("plaintext metadata header is truncated")
    magic, version = struct.unpack_from("<II", plaintext)
    if magic != METADATA_MAGIC:
        raise ValueError(f"plaintext metadata magic changed: 0x{magic:08x}")
    if version != METADATA_VERSION:
        raise ValueError(f"plaintext metadata version changed: {version}")
    words = struct.unpack_from(
        f"<{METADATA_HEADER_SIZE // 4}I", plaintext, 0
    )
    if words[2] != METADATA_HEADER_SIZE:
        raise ValueError("metadata v31 first table does not start after the header")
    if (len(words) - 2) // 2 != METADATA_TABLE_COUNT:
        raise ValueError("metadata v31 table pair count changed")

    tables = []
    padding_ranges = []
    cursor = METADATA_HEADER_SIZE
    for index in range(METADATA_TABLE_COUNT):
        offset = words[2 + index * 2]
        byte_length = words[3 + index * 2]
        if offset % 4:
            raise ValueError(f"metadata table {index} offset is not aligned")
        if offset < cursor:
            raise ValueError(
                f"metadata table {index} overlaps its predecessor"
            )
        padding = plaintext[cursor:offset]
        if len(padding) > 4 or any(padding):
            raise ValueError(
                f"metadata table {index} has invalid inter-table padding"
            )
        if padding:
            padding_ranges.append(
                {
                    "beforeTable": index,
                    "offset": cursor,
                    "byteLength": len(padding),
                    "sha256": sha256(padding),
                }
            )
        end = offset + byte_length
        if end < offset or end > len(plaintext):
            raise ValueError(f"metadata table {index} exceeds the plaintext")
        payload = plaintext[offset:end]
        tables.append(
            {
                "index": index,
                "offset": offset,
                "byteLength": byte_length,
                "sha256": sha256(payload),
            }
        )
        cursor = end
    if cursor != len(plaintext):
        raise ValueError("metadata v31 tables do not consume the complete plaintext")

    return {
        "status": "strict-il2cpp-metadata-v31",
        "magic": f"0x{magic:08x}",
        "version": version,
        "headerByteLength": METADATA_HEADER_SIZE,
        "headerSha256": sha256(plaintext[:METADATA_HEADER_SIZE]),
        "tableCount": len(tables),
        "tableInventorySha256": canonical_digest(tables),
        "tables": tables,
        "paddingRanges": padding_ranges,
        "strictChecks": {
            "exactMagic": True,
            "exactVersion": True,
            "exactHeaderSize": True,
            "exactTableCount": True,
            "alignedOffsets": True,
            "orderedNonOverlappingTables": True,
            "zeroFilledInterTablePadding": True,
            "completePlaintextCoverage": True,
        },
    }


def read_zip_entry(archive_bytes: bytes, entry: str) -> bytes:
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            return archive.read(entry)
    except KeyError as error:
        raise ValueError(f"split APK entry is missing: {entry}") from error
    except zipfile.BadZipFile as error:
        raise ValueError("candidate split is not a valid APK ZIP") from error


def load_candidate_inputs(
    candidate_manifest: Path,
    split_root: Path,
) -> tuple[dict, dict]:
    loaded = load_official_sample(candidate_manifest)
    sample = loaded["sample"]
    if sample["status"] != "candidate":
        raise ValueError("metadata derivation requires a candidate manifest")
    if sample["sampleId"] != EXPECTED_SAMPLE_ID:
        raise ValueError(f"unsupported candidate sample: {sample['sampleId']}")
    if sample["unity"]["serializedVersion"] != EXPECTED_UNITY_VERSION:
        raise ValueError("unsupported candidate Unity version")

    split_names = sample["game"]["packageSource"]["splits"]
    base = (split_root / split_names["baseApk"]).read_bytes()
    arm64 = (split_root / split_names["arm64Split"]).read_bytes()
    verify_identity("base APK", base, sample["artifacts"]["baseApk"])
    verify_identity("arm64 split", arm64, sample["artifacts"]["arm64Split"])
    encrypted = read_zip_entry(base, METADATA_ENTRY)
    libil2cpp = read_zip_entry(arm64, LIBIL2CPP_ENTRY)
    verify_identity(
        "encrypted global metadata",
        encrypted,
        sample["artifacts"]["globalMetadataEncrypted"],
    )
    verify_identity("libil2cpp", libil2cpp, sample["artifacts"]["libil2cpp"])
    return loaded, {
        "baseApk": base,
        "arm64Split": arm64,
        "encryptedMetadata": encrypted,
        "libil2cpp": libil2cpp,
    }


def derive_from_verified_bytes(
    encrypted: bytes,
    libil2cpp: bytes,
    expected_plaintext: dict,
) -> dict:
    native = extract_native_contract(libil2cpp)
    plaintext, transformation = transform_metadata(
        encrypted, native, expected_plaintext
    )
    metadata = validate_metadata_v31(plaintext)
    runtime = native.pop("_runtime")
    if set(runtime) != {"key16", "prefix"}:
        raise AssertionError("unexpected native runtime-only material")
    return {
        "nativeContract": native,
        "transformation": transformation,
        "metadata": metadata,
    }


def extract(candidate_manifest: Path, split_root: Path) -> dict:
    loaded, inputs = load_candidate_inputs(candidate_manifest, split_root)
    sample = loaded["sample"]
    derivation = derive_from_verified_bytes(
        inputs["encryptedMetadata"],
        inputs["libil2cpp"],
        sample["artifacts"]["globalMetadataPlaintext"],
    )
    result = {
        "schema": "pocket-card-render/candidate-metadata-derivation-extraction@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
        },
        "sources": {
            "baseApk": identity(inputs["baseApk"]),
            "arm64Split": identity(inputs["arm64Split"]),
            "libil2cpp": identity(inputs["libil2cpp"]),
            "globalMetadataEncrypted": identity(inputs["encryptedMetadata"]),
            "globalMetadataPlaintextExpected": {
                "byteLength": sample["artifacts"]["globalMetadataPlaintext"][
                    "byteLength"
                ],
                "sha256": sample["artifacts"]["globalMetadataPlaintext"]["sha256"],
            },
        },
        **derivation,
        "claims": {
            "officialShaderRestorationPercent": None,
            "gameFidelity": False,
            "runtimeFidelity": False,
        },
    }
    result["proofSha256"] = canonical_digest(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", type=Path, required=True)
    parser.add_argument("--split-root", type=Path, required=True)
    args = parser.parse_args()
    result = extract(
        args.candidate_manifest.resolve(),
        args.split_root.resolve(),
    )
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"BAD {error}", file=sys.stderr)
        raise SystemExit(1)
