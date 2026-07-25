#!/usr/bin/env python3
"""Differentially verify every shipped SMOL-V record against upstream C++.

This corpus is rooted directly in every decrypted Common/Shader bundle. Material
reachability, scene JSON, recipes, generated GLSL, screenshots, and runtime
captures are deliberately excluded from the denominator.
"""

from __future__ import annotations

import argparse
from collections import Counter
import gc
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

import UnityPy

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))
sys.path.insert(0, str(ROOT / "build" / "shaderdec"))

import extract_official_material_program_inventory as inventory  # noqa: E402
import smolv  # noqa: E402

SCHEMA = "pocket-card-render/official-smolv-corpus@1"
EXPECTED = {
    "bundles": 128,
    "bundleBytes": 2_856_998,
    "cabs": 128,
    "shaders": 128,
    "entries": 572,
    "programEntries": 294,
    "parameterEntries": 278,
    "occurrences": 588,
    "uniqueCompressed": 380,
    "uniqueVertex": 122,
    "uniqueFragment": 258,
    "bundleManifestSha256": "1cfac88cc5a61e8cc5a56df343810bfca7bbc17c3c25d9f2fc89a36e0195a065",
}
EXPECTED_DIGESTS = {
    "occurrencesSha256": "274e29e4fd3d7c6474b3397de5a30a5c643eb6992aae2afc9f9fe45a27da93be",
    "uniqueSmolvSha256": "a952d7d3d4fd08660cffd0218bef4d5c4e51869f8ebf684b4d193eb026c5eef4",
    "uniqueSpirvSha256": "182633665ebcbbcb6117fef33019681cb80a7cef333dbcac7de32dfc5cc9a384",
}
STAGE_BY_EXECUTION_MODEL = {0: "vertex", 4: "fragment"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def shader_blob_references(shader: dict, entry_count: int) -> tuple[set[int], set[int]]:
    program_indices: set[int] = set()
    parameter_indices: set[int] = set()
    parsed = shader.get("m_ParsedForm") or {}
    for subshader in parsed.get("m_SubShaders") or []:
        for shader_pass in subshader.get("m_Passes") or []:
            for stage_name in inventory.SHADER_STAGES:
                stage = shader_pass.get(stage_name) or {}
                program_groups = list(stage.get("m_PlayerSubPrograms") or [])
                parameter_groups = list(stage.get("m_ParameterBlobIndices") or [])
                require(
                    len(program_groups) == len(parameter_groups),
                    f"{stage_name}: program/parameter group counts disagree",
                )
                for group_index, raw_group in enumerate(program_groups):
                    group = list(raw_group or [])
                    parameters = list(parameter_groups[group_index] or [])
                    require(
                        len(group) == len(parameters),
                        f"{stage_name}[{group_index}]: variant/parameter counts disagree",
                    )
                    for variant_index, record in enumerate(group):
                        gpu_type = int(record.get("m_GpuProgramType", -1))
                        require(
                            gpu_type == inventory.VULKAN_PROGRAM_TYPE,
                            f"{stage_name}[{group_index}][{variant_index}]: GPU type {gpu_type}",
                        )
                        program_index = int(record.get("m_BlobIndex", -1))
                        parameter_index = int(parameters[variant_index])
                        require(0 <= program_index < entry_count, "program blob index is out of range")
                        require(0 <= parameter_index < entry_count, "parameter blob index is out of range")
                        program_indices.add(program_index)
                        parameter_indices.add(parameter_index)

    require(program_indices.isdisjoint(parameter_indices), "program and parameter entries overlap")
    require(
        program_indices | parameter_indices == set(range(entry_count)),
        "ShaderProgram table contains an unclassified entry",
    )
    return program_indices, parameter_indices


def strict_program_records(entry: bytes, label: str) -> list[dict]:
    magic = struct.pack("<I", smolv.SMOL_MAGIC)
    offsets = []
    cursor = 0
    while True:
        offset = entry.find(magic, cursor)
        if offset < 0:
            break
        offsets.append(offset)
        cursor = offset + len(magic)
    require(len(offsets) == 2, f"{label}: physical SMOL magic count changed")

    records = []
    for offset in offsets:
        try:
            decoded, consumed = smolv.decode_with_consumed(entry[offset:])
        except Exception as error:
            raise RuntimeError(f"{label}: SMOL decode failed at {offset}: {error}") from error
        require(consumed > 0, f"{label}: decoder consumed no input")
        compressed = entry[offset : offset + consumed]
        require(len(compressed) == consumed, f"{label}: SMOL record is truncated")
        require(len(decoded) == struct.unpack_from("<I", compressed, 20)[0], f"{label}: decoded size drift")
        execution_model = inventory.spirv_execution_model(decoded)
        require(execution_model in STAGE_BY_EXECUTION_MODEL, f"{label}: unexpected execution model")
        records.append({
            "offset": offset,
            "compressed": compressed,
            "decoded": decoded,
            "stage": STAGE_BY_EXECUTION_MODEL[execution_model],
        })
    require(
        records[0]["offset"] + len(records[0]["compressed"]) == records[1]["offset"],
        f"{label}: vertex and fragment SMOL records are not contiguous",
    )
    require(
        sorted(row["stage"] for row in records) == ["fragment", "vertex"],
        f"{label}: expected one vertex and one fragment module",
    )
    suffix_offset = records[-1]["offset"] + len(records[-1]["compressed"])
    layout = {
        "entryByteSize": len(entry),
        "entrySha256": inventory.sha256_bytes(entry),
        "prefixByteSize": records[0]["offset"],
        "prefixSha256": inventory.sha256_bytes(entry[: records[0]["offset"]]),
        "modules": [{
            "offset": row["offset"],
            "compressedByteSize": len(row["compressed"]),
            "compressedSha256": inventory.sha256_bytes(row["compressed"]),
        } for row in records],
        "suffixByteSize": len(entry) - suffix_offset,
        "suffixSha256": inventory.sha256_bytes(entry[suffix_offset:]),
    }
    layout_sha256 = inventory.canonical_digest(layout)
    for row in records:
        row["containerLayoutSha256"] = layout_sha256
    return records


def oracle_decode(oracle: Path, requests: list[bytes]) -> list[tuple[int, bytes]]:
    payload = bytearray()
    for request in requests:
        payload.extend(struct.pack("<I", len(request)))
        payload.extend(request)
    process = subprocess.run(
        [str(oracle)],
        input=bytes(payload),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    require(process.returncode == 0, f"SMOL-V oracle exited {process.returncode}: {process.stderr!r}")
    results = []
    cursor = 0
    for index in range(len(requests)):
        require(cursor + 8 <= len(process.stdout), f"oracle response {index} is truncated")
        status, output_size = struct.unpack_from("<II", process.stdout, cursor)
        cursor += 8
        require(cursor + output_size <= len(process.stdout), f"oracle payload {index} is truncated")
        output = process.stdout[cursor : cursor + output_size]
        cursor += output_size
        results.append((status, output))
    require(cursor == len(process.stdout), "oracle emitted trailing response bytes")
    return results


def validate_spirv_modules(modules: dict[str, bytes], spirv_val: str) -> None:
    with tempfile.TemporaryDirectory(prefix="pcr-smolv-") as directory:
        root = Path(directory)
        for digest, module in sorted(modules.items()):
            path = root / f"{digest}.spv"
            path.write_bytes(module)
            process = subprocess.run(
                [spirv_val, "--target-env", "vulkan1.0", str(path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            require(
                process.returncode == 0,
                f"spirv-val rejected {digest}: {(process.stdout + process.stderr).strip()}",
            )


def extract(decrypted_root: Path, oracle: Path, spirv_val: str) -> dict:
    shader_root = decrypted_root / "Common" / "Shader"
    require(shader_root.is_dir(), f"official Shader root is missing: {shader_root}")
    require(oracle.is_file(), f"compiled upstream oracle is missing: {oracle}")

    bundle_paths = sorted(shader_root.rglob("*_bundles"), key=lambda value: value.as_posix())
    bundle_manifest = []
    cabs: set[str] = set()
    shader_count = 0
    entry_count = 0
    program_count = 0
    parameter_count = 0
    occurrences = []

    for bundle in bundle_paths:
        bundle_bytes = bundle.read_bytes()
        relative_path = bundle.resolve().relative_to(decrypted_root.resolve()).as_posix()
        bundle_manifest.append([relative_path, len(bundle_bytes), inventory.sha256_bytes(bundle_bytes)])
        environment = UnityPy.load(str(bundle))
        bundle_objects = [obj for obj in environment.objects if obj.type.name == "AssetBundle"]
        shader_objects = [obj for obj in environment.objects if obj.type.name == "Shader"]
        owned = inventory.owned_cabs(environment)
        require(len(bundle_objects) == 1, f"{relative_path}: expected one AssetBundle object")
        require(len(shader_objects) == 1, f"{relative_path}: expected one Shader object")
        require(len(owned) == 1, f"{relative_path}: expected one owning CAB")
        cab = next(iter(owned))
        require(cab not in cabs, f"duplicate official Shader CAB: {cab}")
        cabs.add(cab)

        shader_object = shader_objects[0]
        shader_identity = inventory.canonical_identity(cab, int(shader_object.path_id))
        shader = shader_object.read_typetree()
        segments = inventory.shader_program_segments(shader)
        require(len(segments) == 1, f"{shader_identity}: expected one Vulkan segment")
        entries = segments[0]["entries"]
        require(all(row["unknownWord"] == 0 for row in entries), f"{shader_identity}: table word changed")
        programs, parameters = shader_blob_references(shader, len(entries))
        entry_count += len(entries)
        program_count += len(programs)
        parameter_count += len(parameters)

        for index in sorted(parameters):
            require(
                struct.pack("<I", smolv.SMOL_MAGIC) not in entries[index]["raw"],
                f"{shader_identity}: parameter entry {index} contains SMOL magic",
            )
        for index in sorted(programs):
            label = f"{shader_identity}/segment0/entry{index}"
            for record in strict_program_records(entries[index]["raw"], label):
                occurrences.append({
                    "key": f"{shader_identity}:0:{index}:{record['offset']}",
                    **record,
                })
        shader_count += 1
        del environment
    gc.collect()

    require(len(bundle_paths) == EXPECTED["bundles"], "official Shader bundle count drifted")
    require(sum(row[1] for row in bundle_manifest) == EXPECTED["bundleBytes"], "bundle byte total drifted")
    require(len(cabs) == EXPECTED["cabs"], "official Shader CAB count drifted")
    require(shader_count == EXPECTED["shaders"], "official Shader object count drifted")
    require(entry_count == EXPECTED["entries"], "ShaderProgram entry count drifted")
    require(program_count == EXPECTED["programEntries"], "program-entry count drifted")
    require(parameter_count == EXPECTED["parameterEntries"], "parameter-entry count drifted")
    require(len(occurrences) == EXPECTED["occurrences"], "physical SMOL-V occurrence count drifted")
    require(
        inventory.canonical_digest(bundle_manifest) == EXPECTED["bundleManifestSha256"],
        "official Shader bundle manifest drifted",
    )

    unique_compressed: dict[str, tuple[bytes, bytes, str]] = {}
    stage_hashes: dict[str, set[str]] = {"vertex": set(), "fragment": set()}
    unique_modules: dict[str, bytes] = {}
    for row in occurrences:
        compressed_hash = inventory.sha256_bytes(row["compressed"])
        decoded_hash = inventory.sha256_bytes(row["decoded"])
        previous = unique_compressed.get(compressed_hash)
        value = (row["compressed"], row["decoded"], row["stage"])
        require(previous is None or previous == value, "compressed hash collision or inconsistent decode")
        unique_compressed[compressed_hash] = value
        stage_hashes[row["stage"]].add(decoded_hash)
        previous_module = unique_modules.get(decoded_hash)
        require(previous_module is None or previous_module == row["decoded"], "SPIR-V hash collision")
        unique_modules[decoded_hash] = row["decoded"]

    require(len(unique_compressed) == EXPECTED["uniqueCompressed"], "unique SMOL-V count drifted")
    require(len(stage_hashes["vertex"]) == EXPECTED["uniqueVertex"], "unique vertex count drifted")
    require(len(stage_hashes["fragment"]) == EXPECTED["uniqueFragment"], "unique fragment count drifted")

    requests = []
    expectations = []
    truncation_rejections = 0
    for digest, (compressed, decoded, _stage) in sorted(unique_compressed.items()):
        requests.append(compressed)
        expectations.append((digest, decoded))
        try:
            _mutated, consumed = smolv.decode_with_consumed(compressed[:-1])
            require(consumed != len(compressed) - 1, f"Python accepted truncated SMOL-V {digest}")
        except Exception:
            truncation_rejections += 1
    responses = oracle_decode(oracle, requests)
    for (digest, expected_output), (status, output) in zip(expectations, responses):
        require(status == 0, f"upstream C++ rejected valid SMOL-V {digest}")
        require(output == expected_output, f"Python/C++ decoded bytes differ for {digest}")
    require(truncation_rejections == len(unique_compressed), "not all truncated records were rejected")

    validate_spirv_modules(unique_modules, spirv_val)
    occurrence_rows = [{
        "key": row["key"],
        "stage": row["stage"],
        "smolvSha256": inventory.sha256_bytes(row["compressed"]),
        "spirvSha256": inventory.sha256_bytes(row["decoded"]),
        "containerLayoutSha256": row["containerLayoutSha256"],
    } for row in occurrences]
    summary = {
        **{key: value for key, value in EXPECTED.items() if key != "bundleManifestSha256"},
        "validatedUniqueSpirv": len(unique_modules),
        "truncationMutationsRejected": truncation_rejections,
    }
    digests = {
        "bundleManifestSha256": inventory.canonical_digest(bundle_manifest),
        "occurrencesSha256": inventory.canonical_digest(occurrence_rows),
        "uniqueSmolvSha256": inventory.canonical_digest(sorted(unique_compressed)),
        "uniqueSpirvSha256": inventory.canonical_digest(sorted(unique_modules)),
    }
    require(digests["occurrencesSha256"] == EXPECTED_DIGESTS["occurrencesSha256"],
            "physical SMOL-V occurrence graph drifted")
    require(digests["uniqueSmolvSha256"] == EXPECTED_DIGESTS["uniqueSmolvSha256"],
            "unique SMOL-V content set drifted")
    require(digests["uniqueSpirvSha256"] == EXPECTED_DIGESTS["uniqueSpirvSha256"],
            "decoded SPIR-V content set drifted")
    return {
        "schema": SCHEMA,
        "source": {
            "decryptedRoot": decrypted_root.as_posix(),
            "definition": "all serialized Common/Shader ShaderProgram entries",
            "excludedInputs": ["Material reachability", "portIndex", "scene JSON", "recipe", "GLSL", "screenshot"],
        },
        "summary": summary,
        "digests": digests,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", inventory.DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--spirv-val", default=os.environ.get("SPIRV_VAL", "spirv-val"))
    args = parser.parse_args()
    result = extract(args.decrypted_root, args.oracle, args.spirv_val)
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
