#!/usr/bin/env python3
"""Mutation tests for the candidate metadata derivation proof."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
EXTRACTOR_PATH = ROOT / "build" / "extract_candidate_metadata_derivation.py"
SPEC = importlib.util.spec_from_file_location(
    "candidate_metadata_derivation", EXTRACTOR_PATH
)
assert SPEC and SPEC.loader
DERIVATION = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DERIVATION
SPEC.loader.exec_module(DERIVATION)

CANDIDATE = (
    ROOT
    / "build"
    / "official-samples"
    / "ptcgp-1.7.0-unity-6000.0.69f1-candidate.json"
)
SPLITS = (
    ROOT.parent
    / "ptcg-apk-parser"
    / "apks"
    / "apkeep-downloads"
    / "jp.pokemon.pokemontcgp"
    / "jp.pokemon.pokemontcgp"
)


def must_fail(label: str, operation, expected: str) -> None:
    try:
        operation()
    except ValueError as error:
        if expected not in str(error):
            raise AssertionError(
                f"{label} failed for the wrong reason: {error}"
            ) from error
    else:
        raise AssertionError(f"{label} mutation did not fail closed")


def mutate_rva(data: bytes, rva: int) -> bytes:
    elf = DERIVATION.Elf64(data)
    return elf.mutate_rva(rva)


def main() -> None:
    if not CANDIDATE.is_file() or not SPLITS.is_dir():
        print("Candidate metadata mutation tests SKIP: local official splits unavailable")
        return
    loaded, inputs = DERIVATION.load_candidate_inputs(CANDIDATE, SPLITS)
    expected = loaded["sample"]["artifacts"]["globalMetadataPlaintext"]
    encrypted = inputs["encryptedMetadata"]
    libil2cpp = inputs["libil2cpp"]

    baseline = DERIVATION.derive_from_verified_bytes(
        encrypted, libil2cpp, expected
    )
    assert baseline["transformation"]["reencrypt"][
        "byteEqualToReconstructedCiphertext"
    ]
    assert baseline["metadata"]["tableCount"] == 31

    must_fail(
        "caller KEY8 immediate",
        lambda: DERIVATION.derive_from_verified_bytes(
            encrypted,
            mutate_rva(libil2cpp, 0x3263564),
            expected,
        ),
        "KEY8 low immediate changed",
    )
    table_rva = int(
        baseline["nativeContract"]["profile"]["table"]["rva"], 16
    )
    must_fail(
        "native key table",
        lambda: DERIVATION.derive_from_verified_bytes(
            encrypted,
            mutate_rva(libil2cpp, table_rva),
            expected,
        ),
        "derived plaintext identity",
    )
    prefix_rva = int(
        baseline["nativeContract"]["profile"][
            "embeddedCiphertextPrefix"
        ]["rva"],
        16,
    )
    must_fail(
        "embedded ciphertext prefix",
        lambda: DERIVATION.derive_from_verified_bytes(
            encrypted,
            mutate_rva(libil2cpp, prefix_rva),
            expected,
        ),
        "derived plaintext identity",
    )
    must_fail(
        "counter increment instruction",
        lambda: DERIVATION.extract_native_contract(
            mutate_rva(libil2cpp, 0x325AD7C)
        ),
        "counter increment changed",
    )
    aes_table_rva = int(
        baseline["nativeContract"]["aesEvidence"][
            "encryptionTables"
        ][0]["rva"],
        16,
    )
    must_fail(
        "AES canonical table",
        lambda: DERIVATION.extract_native_contract(
            mutate_rva(libil2cpp, aes_table_rva)
        ),
        "not canonical",
    )

    mutated_encrypted = bytearray(encrypted)
    mutated_encrypted[-1] ^= 1
    must_fail(
        "encrypted suffix payload",
        lambda: DERIVATION.derive_from_verified_bytes(
            bytes(mutated_encrypted), libil2cpp, expected
        ),
        "derived plaintext identity",
    )

    native = DERIVATION.extract_native_contract(libil2cpp)
    plaintext, _transformation = DERIVATION.transform_metadata(
        encrypted, native, expected
    )
    mutated_metadata = bytearray(plaintext)
    mutated_metadata[8] ^= 4
    must_fail(
        "metadata v31 header",
        lambda: DERIVATION.validate_metadata_v31(bytes(mutated_metadata)),
        "first table",
    )
    print("Candidate metadata derivation mutation tests OK")


if __name__ == "__main__":
    main()
