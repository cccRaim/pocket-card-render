#!/usr/bin/env python3
"""Build an official-byte material/program proof graph for every available L card.

The graph starts at serialized MeshRenderer material slots.  Scene JSON and
render recipes are intentionally not inputs: they may be used later as locators
or implementation manifests, but they cannot define the official corpus.

The compact output retains counts, exceptional rows, and canonical digests of
the complete usage/material/selector graph.  ``--full`` additionally emits the
complete rows for forensic work and is intended for ignored cache artifacts.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from functools import lru_cache
import gc
import hashlib
import json
import lz4.block
import os
from pathlib import Path
import re
import struct
import sys
import warnings

try:
    import UnityPy
except ImportError as exc:
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
UNITY_VERSION = "2022.3.62f2"
SCHEMA = "pocket-card-render/official-material-program-inventory@4"
IDENTITY_RE = re.compile(r"^(CAB-[0-9a-f]{32}):(-?[0-9]+)$")
CAB_HEADER_RE = re.compile(rb"CAB-[0-9a-fA-F]{32}")
VULKAN_PROGRAM_TYPE = 25
SHADER_PROGRAM_VERSION = 202012090
SHADER_CHANNEL_NAMES = {
    0: "Vertex",
    1: "Normal",
    2: "Tangent",
    3: "Color",
    4: "UV0",
    5: "UV1",
    6: "UV2",
    7: "UV3",
    8: "UV4",
    9: "UV5",
    10: "UV6",
    11: "UV7",
    12: "SkinWeight",
    13: "SkinBoneIndex",
}
VERTEX_COMPONENT_NAMES = {
    0: "Vertex",
    1: "Color",
    2: "Normal",
    3: "TexCoord",
    4: "TexCoord0",
    5: "TexCoord1",
    6: "TexCoord2",
    7: "TexCoord3",
    8: "TexCoord4",
    9: "TexCoord5",
    10: "TexCoord6",
    11: "TexCoord7",
    **{12 + index: f"Attrib{index}" for index in range(16)},
}
SHADER_STAGES = (
    "progVertex",
    "progFragment",
    "progGeometry",
    "progHull",
    "progDomain",
)
NATIVE_VARIANT_SELECTION = {
    "unityVersion": UNITY_VERSION,
    "libunitySha256": "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
    "computeKeywordMatchBodySha256": "5265cc641b149955d106a95401a9e0a082db9ee6fc44974cb6d2b69a4aa09ca0",
    "findBestMatchingBodySha256": "c6a1fa408892d54c9558c07e4eb05f436b37b4b7da05b6b3c8e8f27843c6d766",
    "getMatchingBodySha256": "5c9c04efabee614548964f7ef8be069cd05e2cc893636f6f9e64d738b02993dd",
    "bootConfigSha256": "b886ce8a232bda260099e3639b8718ae7336a244bf5a097fd3119f74b1017bcd",
    "strictShaderVariantMatching": False,
    "score": "popcount(requested & candidate) - 16 * popcount(candidate & ~requested)",
    "tieBreak": "first-serialized-candidate",
    "audit": "build/audit-official-shader-variant-selection.mjs",
}

UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@lru_cache(maxsize=None)
def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return sha256_bytes(encoded)


def canonical_identity(cab: str, path_id: int) -> str:
    identity = f"{cab}:{path_id}"
    if IDENTITY_RE.fullmatch(identity) is None:
        raise RuntimeError(f"invalid official object identity: {identity}")
    return identity


def pptr_identity(owner: object, pointer: object, label: str) -> str:
    if not isinstance(pointer, dict):
        raise RuntimeError(f"{label} is not a serialized PPtr")
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if path_id == 0:
        raise RuntimeError(f"{label} is a null PPtr")
    if file_id == 0:
        cab = str(owner.assets_file.name)
    else:
        externals = owner.assets_file.externals
        if file_id < 1 or file_id > len(externals):
            raise RuntimeError(f"{label} file ID {file_id} is outside the external table")
        cab = str(externals[file_id - 1].name)
    return canonical_identity(cab, path_id)


def enabled_keywords(material: dict) -> list[str]:
    legacy = material.get("m_ShaderKeywords") or ""
    if isinstance(legacy, str):
        legacy_keywords = legacy.split()
    else:
        legacy_keywords = list(legacy or [])
    valid = list(material.get("m_ValidKeywords") or [])
    return sorted({str(keyword) for keyword in legacy_keywords + valid if keyword})


def pair_rows(value: object) -> list[list[object]]:
    rows = []
    for pair in value or []:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            rows.append([str(pair[0]), pair[1]])
        elif isinstance(pair, dict) and "first" in pair and "second" in pair:
            rows.append([str(pair["first"]), pair["second"]])
        else:
            raise RuntimeError("serialized saved-property row is not a key/value pair")
    return rows


def saved_properties_record(owner: object, material: dict) -> dict:
    saved = material.get("m_SavedProperties") or {}
    texture_rows = []
    for name, value in pair_rows(saved.get("m_TexEnvs")):
        pointer = (value or {}).get("m_Texture") or {}
        path_id = int(pointer.get("m_PathID", 0))
        texture_rows.append({
            "name": name,
            "texture": pptr_identity(owner, pointer, f"texture {name}") if path_id else None,
            "scale": (value or {}).get("m_Scale"),
            "offset": (value or {}).get("m_Offset"),
        })
    record = {
        "ints": pair_rows(saved.get("m_Ints")),
        "floats": pair_rows(saved.get("m_Floats")),
        "colors": pair_rows(saved.get("m_Colors")),
        "textures": texture_rows,
    }
    return {
        "digest": canonical_digest(record),
        "textureBindings": len(texture_rows),
        "nonNullTextures": sum(row["texture"] is not None for row in texture_rows),
        "textureIdentitiesSha256": canonical_digest(
            [[row["name"], row["texture"]] for row in texture_rows]
        ),
    }


def object_map(environment: object) -> dict[tuple[str, int], object]:
    return {
        (str(obj.assets_file.name), int(obj.path_id)): obj
        for obj in environment.objects
    }


def owned_cabs(environment: object) -> set[str]:
    return {str(obj.assets_file.name) for obj in environment.objects}


def register_bundle(locator: dict[str, Path], path: Path) -> None:
    environment = UnityPy.load(str(path))
    for cab in owned_cabs(environment):
        previous = locator.get(cab)
        if previous is not None and previous.resolve() != path.resolve():
            raise RuntimeError(f"duplicate official CAB {cab}: {previous} and {path}")
        locator[cab] = path.resolve()
    del environment


def bundle_owner_cab(path: Path) -> str | None:
    """Read a candidate owner CAB identity from a UnityFS header."""
    try:
        with path.open("rb") as handle:
            header = handle.read(512)
    except OSError:
        return None
    match = CAB_HEADER_RE.search(header)
    if not match:
        return None
    value = match.group(0).decode("ascii")
    return f"CAB-{value[4:].lower()}"


def locate_owner_cab_bundles(
    decrypted_root: Path,
    locator: dict[str, Path],
    target_cabs: set[str],
) -> None:
    """Locate unresolved direct dependencies by official UnityFS owner CAB.

    The fast-path roots cover normal Face/Common material ownership.  This
    snapshot-wide fallback is only used for remaining CABs, such as shared
    CardNew logo materials stored outside Common/CardNew.
    """
    remaining = set(target_cabs) - set(locator)
    if not remaining:
        return
    seen: set[Path] = set()
    headerless: list[Path] = []
    candidates = (
        decrypted_root.glob("*_bundles"),
        decrypted_root.glob("*/*_bundles"),
        decrypted_root.rglob("*_bundles"),
    )
    for paths in candidates:
        for path in paths:
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            cab = bundle_owner_cab(path)
            if cab is None:
                headerless.append(path)
                continue
            if cab not in remaining:
                continue
            register_bundle(locator, path)
            remaining = set(target_cabs) - set(locator)
            if not remaining:
                return

    # A CAB header is only a fast candidate hint. If the hint index does not
    # close the direct dependency set, authoritatively inspect headerless
    # bundles before reporting a locator boundary.
    for path in headerless:
        register_bundle(locator, path)
        remaining = set(target_cabs) - set(locator)
        if not remaining:
            return


def material_record(obj: object, bundle: Path, decrypted_root: Path) -> dict:
    tree = obj.read_typetree()
    raw = bytes(obj.get_raw_data())
    identity = canonical_identity(str(obj.assets_file.name), int(obj.path_id))
    keywords = enabled_keywords(tree)
    shader = pptr_identity(obj, tree.get("m_Shader"), f"Material {identity}.m_Shader")
    return {
        "identity": identity,
        "name": str(tree.get("m_Name") or ""),
        "sourceBundle": bundle.resolve().relative_to(decrypted_root).as_posix(),
        "sourceBundleSha256": sha256_file(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "shaderIdentity": shader,
        "keywords": keywords,
        "invalidKeywords": sorted(str(value) for value in (tree.get("m_InvalidKeywords") or [])),
        "customRenderQueue": int(tree.get("m_CustomRenderQueue", -1)),
        "enableInstancingVariants": bool(tree.get("m_EnableInstancingVariants", False)),
        "doubleSidedGI": bool(tree.get("m_DoubleSidedGI", False)),
        "disabledShaderPasses": sorted(str(value) for value in (tree.get("disabledShaderPasses") or [])),
        "savedProperties": saved_properties_record(obj, tree),
    }


def shader_record(obj: object, bundle: Path, decrypted_root: Path) -> tuple[dict, dict]:
    tree = obj.read_typetree()
    raw = bytes(obj.get_raw_data())
    identity = canonical_identity(str(obj.assets_file.name), int(obj.path_id))
    parsed = tree.get("m_ParsedForm") or {}
    keyword_names = [str(value) for value in parsed.get("m_KeywordNames", [])]
    compact = {
        "identity": identity,
        "name": str(tree.get("m_Name") or parsed.get("m_Name") or ""),
        "sourceBundle": bundle.resolve().relative_to(decrypted_root).as_posix(),
        "sourceBundleSha256": sha256_file(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "keywordNames": keyword_names,
        "platforms": [int(value) for value in (tree.get("platforms") or [])],
        "compressedBlobSha256": sha256_bytes(bytes(tree.get("compressedBlob") or [])),
    }
    return compact, tree


def static_vulkan_candidates(shader: dict, keywords: tuple[str, ...]) -> tuple[list[dict], list[str]]:
    parsed = shader.get("m_ParsedForm") or {}
    keyword_names = [str(value) for value in (parsed.get("m_KeywordNames") or [])]
    unknown = sorted(set(keywords) - set(keyword_names))
    if unknown:
        return [], unknown

    candidates: dict[tuple, dict] = {}
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders") or []):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes") or []):
            for stage_name in SHADER_STAGES:
                stage = shader_pass.get(stage_name) or {}
                player_groups = stage.get("m_PlayerSubPrograms") or []
                parameter_groups = stage.get("m_ParameterBlobIndices") or []
                for group_index, group in enumerate(player_groups):
                    parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
                    for variant_index, record in enumerate(group or []):
                        if int(record.get("m_GpuProgramType", -1)) != VULKAN_PROGRAM_TYPE:
                            continue
                        indices = [int(value) for value in (record.get("m_KeywordIndices") or [])]
                        if any(index < 0 or index >= len(keyword_names) for index in indices):
                            raise RuntimeError("compiled Shader keyword index is outside m_KeywordNames")
                        compiled = tuple(sorted(keyword_names[index] for index in indices))
                        if compiled != keywords:
                            continue
                        parameter_index = (
                            int(parameters[variant_index])
                            if variant_index < len(parameters)
                            else None
                        )
                        key = (
                            subshader_index,
                            pass_index,
                            int(record.get("m_BlobIndex", -1)),
                            parameter_index,
                            compiled,
                        )
                        row = candidates.setdefault(key, {
                            "subshader": subshader_index,
                            "pass": pass_index,
                            "programBlobIndex": int(record.get("m_BlobIndex", -1)),
                            "parameterBlobIndex": parameter_index,
                            "gpuProgramType": VULKAN_PROGRAM_TYPE,
                            "keywordIndices": indices,
                            "keywords": list(compiled),
                            "shaderRequirements": int(record.get("m_ShaderRequirements", 0)),
                            "stages": [],
                        })
                        if row["shaderRequirements"] != int(record.get("m_ShaderRequirements", 0)):
                            raise RuntimeError("deduplicated Vulkan candidate changed shader requirements")
                        row["stages"].append({
                            "stageMetadata": stage_name,
                            "playerGroup": group_index,
                            "variantIndex": variant_index,
                        })
    return sorted(candidates.values(), key=lambda row: (
        row["subshader"], row["pass"], row["programBlobIndex"],
        -1 if row["parameterBlobIndex"] is None else row["parameterBlobIndex"],
    )), []


def native_best_match_vulkan_candidates(
    shader: dict, keywords: tuple[str, ...]
) -> tuple[list[dict], list[str]]:
    """Apply the version-locked Unity 2022.3 native keyword score per pass.

    The companion native audit pins ComputeKeywordMatch, the strict/best branch,
    tie behavior, and the game's boot.config. This function only interprets the
    serialized candidate table under that separately verified contract.
    """
    parsed = shader.get("m_ParsedForm") or {}
    keyword_names = [str(value) for value in (parsed.get("m_KeywordNames") or [])]
    unknown = sorted(set(keywords) - set(keyword_names))
    if unknown:
        return [], unknown
    requested = set(keywords)
    candidates: dict[tuple, dict] = {}
    serialized_order = 0
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders") or []):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes") or []):
            for stage_name in SHADER_STAGES:
                stage = shader_pass.get(stage_name) or {}
                player_groups = stage.get("m_PlayerSubPrograms") or []
                parameter_groups = stage.get("m_ParameterBlobIndices") or []
                for group_index, group in enumerate(player_groups):
                    parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
                    for variant_index, record in enumerate(group or []):
                        if int(record.get("m_GpuProgramType", -1)) != VULKAN_PROGRAM_TYPE:
                            continue
                        indices = [int(value) for value in (record.get("m_KeywordIndices") or [])]
                        if any(index < 0 or index >= len(keyword_names) for index in indices):
                            raise RuntimeError("compiled Shader keyword index is outside m_KeywordNames")
                        compiled = tuple(sorted(keyword_names[index] for index in indices))
                        parameter_index = (
                            int(parameters[variant_index])
                            if variant_index < len(parameters)
                            else None
                        )
                        key = (
                            subshader_index,
                            pass_index,
                            int(record.get("m_BlobIndex", -1)),
                            parameter_index,
                            compiled,
                        )
                        row = candidates.setdefault(key, {
                            "subshader": subshader_index,
                            "pass": pass_index,
                            "programBlobIndex": int(record.get("m_BlobIndex", -1)),
                            "parameterBlobIndex": parameter_index,
                            "gpuProgramType": VULKAN_PROGRAM_TYPE,
                            "keywordIndices": indices,
                            "keywords": list(compiled),
                            "shaderRequirements": int(record.get("m_ShaderRequirements", 0)),
                            "serializedOrder": serialized_order,
                            "stages": [],
                        })
                        row["stages"].append({
                            "stageMetadata": stage_name,
                            "playerGroup": group_index,
                            "variantIndex": variant_index,
                        })
                        serialized_order += 1
    by_pass: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for row in candidates.values():
        compiled = set(row["keywords"])
        row["keywordMatchScore"] = len(requested & compiled) - 16 * len(compiled - requested)
        by_pass[(row["subshader"], row["pass"])].append(row)
    if len({key[0] for key in by_pass}) != 1:
        raise RuntimeError("native best-match spans multiple serialized SubShaders")
    selected = []
    for pass_key in sorted(by_pass):
        rows = sorted(by_pass[pass_key], key=lambda row: row["serializedOrder"])
        best_score = max(row["keywordMatchScore"] for row in rows)
        ties = [row for row in rows if row["keywordMatchScore"] == best_score]
        winner = ties[0]
        winner["nativeBestMatch"] = {
            "candidateCount": len(rows),
            "bestScore": best_score,
            "tiedBestCandidates": len(ties),
            "tieBreak": "first-serialized-candidate",
        }
        selected.append(winner)
    return selected, []


def nested_row(values: list, index: int) -> list:
    value = values[index]
    return list(value) if isinstance(value, (list, tuple)) else [value]


def shader_program_segments(shader: dict) -> list[dict]:
    platforms = [int(value) for value in (shader.get("platforms") or [])]
    if platforms != [18]:
        raise RuntimeError(f"version-locked card Shader platforms changed: {platforms}")
    platform_index = 0
    offsets = nested_row(shader.get("offsets") or [], platform_index)
    compressed_lengths = nested_row(shader.get("compressedLengths") or [], platform_index)
    decompressed_lengths = nested_row(shader.get("decompressedLengths") or [], platform_index)
    if not (len(offsets) == len(compressed_lengths) == len(decompressed_lengths)):
        raise RuntimeError("Vulkan ShaderProgram segment arrays disagree")
    if len(offsets) != 1:
        raise RuntimeError(
            f"version-locked card Shader has {len(offsets)} Vulkan segments; "
            "segment selection cannot be inferred from blob index"
        )
    blob = bytes(shader.get("compressedBlob") or [])
    segments = []
    for segment_index, (raw_offset, raw_length, raw_decoded_length) in enumerate(zip(
        offsets, compressed_lengths, decompressed_lengths
    )):
        offset = int(raw_offset)
        compressed_length = int(raw_length)
        decompressed_length = int(raw_decoded_length)
        compressed = blob[offset : offset + compressed_length]
        if len(compressed) != compressed_length:
            raise RuntimeError("compressed ShaderProgram segment is truncated")
        decoded = lz4.block.decompress(compressed, uncompressed_size=decompressed_length)
        if len(decoded) != decompressed_length or len(decoded) < 4:
            raise RuntimeError("decompressed ShaderProgram segment length changed")
        count = struct.unpack_from("<I", decoded, 0)[0]
        table_end = 4 + count * 12
        if table_end > len(decoded):
            raise RuntimeError("ShaderProgram table is truncated")
        entries = []
        expected_offset = table_end
        for entry_index in range(count):
            entry_offset, entry_length, unknown = struct.unpack_from(
                "<III", decoded, 4 + entry_index * 12
            )
            if entry_offset != expected_offset or entry_offset + entry_length > len(decoded):
                raise RuntimeError("ShaderProgram entries are not contiguous")
            raw = decoded[entry_offset : entry_offset + entry_length]
            entries.append({
                "index": entry_index,
                "offset": entry_offset,
                "byteSize": len(raw),
                "unknownWord": int(unknown),
                "sha256": sha256_bytes(raw),
                "raw": raw,
            })
            expected_offset = entry_offset + entry_length
        if expected_offset != len(decoded):
            raise RuntimeError("ShaderProgram table has unaccounted trailing bytes")
        segments.append({
            "segmentIndex": segment_index,
            "compressedOffset": offset,
            "compressedByteSize": compressed_length,
            "compressedSha256": sha256_bytes(compressed),
            "decompressedByteSize": decompressed_length,
            "decompressedSha256": sha256_bytes(decoded),
            "entries": entries,
        })
    return segments


def trim_spirv(module: bytes) -> bytes:
    if len(module) < 24 or len(module) % 4:
        raise RuntimeError("decoded module is not aligned SPIR-V")
    words = struct.unpack(f"<{len(module) // 4}I", module)
    if words[0] != smolv.SPIRV_MAGIC:
        raise RuntimeError("decoded module has invalid SPIR-V magic")
    cursor = 5
    end = None
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length < 1 or cursor + length > len(words):
            # Unity's SMOL-V container may leave aligned bytes after the final
            # module. The official exact extractors trim at the last complete
            # OpFunctionEnd and do not interpret this container padding.
            break
        if opcode == 56:
            end = cursor + length
        cursor += length
    if end is None:
        raise RuntimeError("SPIR-V module has no OpFunctionEnd")
    return struct.pack(f"<{end}I", *words[:end])


def spirv_execution_model(module: bytes) -> int:
    words = struct.unpack(f"<{len(module) // 4}I", module)
    cursor = 5
    models = []
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length < 1 or cursor + length > len(words):
            raise RuntimeError("malformed SPIR-V instruction stream")
        if opcode == 15:
            models.append(int(words[cursor + 1]))
        cursor += length
    if len(models) != 1:
        raise RuntimeError(f"SPIR-V module has {len(models)} entry points")
    return models[0]


def parse_program_bind_channels(entry: bytes) -> dict:
    """Parse Unity 2021.2+ ShaderSubProgram program data with strict EOF.

    The layout follows Unity's serialized ShaderSubProgram contract for the
    version-locked 2022.3.62f2 target. Bind-channel source values are official
    mesh semantics; target values are retained as serialized VertexComponent
    values and are not guessed into WebGL attribute names here.
    """

    cursor = 0

    def require(size: int, label: str) -> None:
        if size < 0 or cursor + size > len(entry):
            raise RuntimeError(f"ShaderSubProgram {label} is truncated")

    def read_i32(label: str) -> int:
        nonlocal cursor
        require(4, label)
        value = struct.unpack_from("<i", entry, cursor)[0]
        cursor += 4
        return int(value)

    def read_u32(label: str) -> int:
        nonlocal cursor
        require(4, label)
        value = struct.unpack_from("<I", entry, cursor)[0]
        cursor += 4
        return int(value)

    def read_bytes(size: int, label: str) -> bytes:
        nonlocal cursor
        require(size, label)
        value = entry[cursor:cursor + size]
        cursor += size
        return value

    def align4(label: str) -> None:
        nonlocal cursor
        aligned = (cursor + 3) & ~3
        require(aligned - cursor, label)
        padding = entry[cursor:aligned]
        if any(padding):
            raise RuntimeError(f"ShaderSubProgram {label} has non-zero alignment bytes")
        cursor = aligned

    version = read_i32("version")
    if version != SHADER_PROGRAM_VERSION:
        raise RuntimeError(
            f"ShaderSubProgram version changed: {version} != {SHADER_PROGRAM_VERSION}"
        )
    header = {
        "version": version,
        "programType": read_i32("program type"),
        "statsALU": read_i32("ALU statistics"),
        "statsTEX": read_i32("texture statistics"),
        "statsFlow": read_i32("flow statistics"),
        "statsTempRegister": read_i32("temporary-register statistics"),
    }
    if header["programType"] != VULKAN_PROGRAM_TYPE:
        raise RuntimeError(
            f"ShaderSubProgram program type changed: {header['programType']}"
        )

    keyword_count = read_i32("merged keyword count")
    if keyword_count < 0 or keyword_count > 1_000_000:
        raise RuntimeError(f"invalid merged keyword count: {keyword_count}")
    merged_keywords = []
    for index in range(keyword_count):
        byte_size = read_i32(f"merged keyword {index} byte size")
        if byte_size < 0:
            raise RuntimeError(f"merged keyword {index} has negative byte size")
        raw = read_bytes(byte_size, f"merged keyword {index}")
        try:
            merged_keywords.append(raw.decode("utf-8"))
        except UnicodeDecodeError as error:
            raise RuntimeError(f"merged keyword {index} is not UTF-8") from error
        align4(f"merged keyword {index}")

    program_data_size = read_i32("program data byte size")
    if program_data_size < 0:
        raise RuntimeError("ShaderSubProgram program data has negative byte size")
    program_data_offset = cursor
    program_data = read_bytes(program_data_size, "program data")
    align4("program data")

    serialized_source_map = read_i32("bind-channel source map")
    if serialized_source_map < 0:
        raise RuntimeError("ShaderSubProgram bind-channel source map is negative")
    bind_count = read_i32("bind-channel count")
    if bind_count < 0 or bind_count > len(SHADER_CHANNEL_NAMES):
        raise RuntimeError(f"invalid bind-channel count: {bind_count}")
    channels = []
    bound_source_map = 0
    for index in range(bind_count):
        source = read_u32(f"bind channel {index} source")
        target = read_u32(f"bind channel {index} target")
        source_name = SHADER_CHANNEL_NAMES.get(source)
        target_name = VERTEX_COMPONENT_NAMES.get(target)
        if source_name is None:
            raise RuntimeError(f"bind channel {index} has unknown ShaderChannel {source}")
        if target_name is None:
            raise RuntimeError(f"bind channel {index} has unknown VertexComponent {target}")
        bound_source_map |= 1 << source
        channels.append({
            "index": index,
            "source": source,
            "sourceName": source_name,
            "target": target,
            "targetName": target_name,
        })
    if cursor != len(entry):
        raise RuntimeError(
            f"ShaderSubProgram has {len(entry) - cursor} unaccounted trailing bytes"
        )
    if serialized_source_map != bound_source_map:
        raise RuntimeError(
            "ShaderSubProgram serialized source map does not equal its bind channels: "
            f"0x{serialized_source_map:x} != 0x{bound_source_map:x}"
        )

    contract = {
        "header": header,
        "mergedKeywords": merged_keywords,
        "programDataOffset": program_data_offset,
        "programDataByteSize": len(program_data),
        "programDataSha256": sha256_bytes(program_data),
        "serializedSourceMap": serialized_source_map,
        "bindChannels": channels,
    }
    return {
        **contract,
        "sha256": canonical_digest(contract),
    }


def decode_program_modules(entry: bytes) -> dict:
    stage_names = {
        0: "vertex",
        1: "tessellation-control",
        2: "tessellation-evaluation",
        3: "geometry",
        4: "fragment",
        5: "compute",
    }
    bind_channels = parse_program_bind_channels(entry)
    modules = []
    records = smolv.find_and_decode_records(entry)
    for module_index, record in enumerate(records):
        smolv_offset = record["offset"]
        decoded = record["decoded"]
        module = trim_spirv(decoded)
        if len(module) != len(decoded):
            raise RuntimeError("strict SMOL-V decoded size extends beyond complete SPIR-V module")
        execution_model = spirv_execution_model(module)
        modules.append({
            "indexInProgramEntry": module_index,
            "smolvOffset": int(smolv_offset),
            "stage": stage_names.get(execution_model, f"execution-model-{execution_model}"),
            "executionModel": execution_model,
            "smolvByteSize": int(record["compressed_size"]),
            "smolvSha256": sha256_bytes(record["compressed"]),
            "byteSize": len(module),
            "sha256": sha256_bytes(module),
        })
    stages = sorted(row["stage"] for row in modules)
    if stages != ["fragment", "vertex"]:
        raise RuntimeError(f"card program stages are not one vertex + one fragment: {stages}")
    regions = []
    cursor = 0
    for record in records:
        offset = int(record["offset"])
        if offset > cursor:
            raw = entry[cursor:offset]
            regions.append({"offset": cursor, "byteSize": len(raw), "sha256": sha256_bytes(raw)})
        cursor = offset + int(record["compressed_size"])
    if cursor < len(entry):
        raw = entry[cursor:]
        regions.append({"offset": cursor, "byteSize": len(raw), "sha256": sha256_bytes(raw)})
    layout = {
        "entryByteSize": len(entry),
        "modules": [{
            "offset": row["smolvOffset"],
            "compressedByteSize": row["smolvByteSize"],
            "compressedSha256": row["smolvSha256"],
        } for row in modules],
        "nonModuleRegions": regions,
    }
    return {
        "modules": modules,
        "programBindChannels": bind_channels,
        "containerLayout": layout,
        "containerLayoutSha256": canonical_digest(layout),
    }


def pass_contract(shader: dict, candidate: dict) -> dict:
    parsed = shader.get("m_ParsedForm") or {}
    subshaders = parsed.get("m_SubShaders") or []
    subshader_index = int(candidate["subshader"])
    pass_index = int(candidate["pass"])
    if subshader_index >= len(subshaders):
        raise RuntimeError("candidate subshader index is outside serialized Shader")
    subshader = subshaders[subshader_index]
    passes = subshader.get("m_Passes") or []
    if pass_index >= len(passes):
        raise RuntimeError("candidate pass index is outside serialized Shader")
    shader_pass = passes[pass_index]
    common_parameters = {
        stage: (shader_pass.get(stage) or {}).get("m_CommonParameters") or {}
        for stage in SHADER_STAGES
    }
    contract = {
        "subshader": subshader_index,
        "subshaderLod": int(subshader.get("m_LOD", 0)),
        "subshaderTags": subshader.get("m_Tags") or {},
        "pass": pass_index,
        "passName": str((shader_pass.get("m_State") or {}).get("m_Name") or ""),
        "passType": int(shader_pass.get("m_Type", -1)),
        "programMask": int(shader_pass.get("m_ProgramMask", 0)),
        "passTags": shader_pass.get("m_Tags") or {},
        "platforms": [int(value) for value in (shader_pass.get("m_Platforms") or [])],
        "hasInstancingVariant": bool(shader_pass.get("m_HasInstancingVariant", False)),
        "hasProceduralInstancingVariant": bool(
            shader_pass.get("m_HasProceduralInstancingVariant", False)
        ),
        "state": shader_pass.get("m_State") or {},
    }
    bindings = {
        "nameIndices": shader_pass.get("m_NameIndices") or [],
        "commonParameters": common_parameters,
    }
    return {
        "contract": contract,
        "passStateSha256": canonical_digest(contract),
        "commonBindingsSha256": canonical_digest(bindings),
    }


def resolve_static_executable(shader: dict, candidate: dict) -> dict:
    program_index = int(candidate["programBlobIndex"])
    parameter_index = candidate["parameterBlobIndex"]
    if parameter_index is None:
        raise RuntimeError("static Vulkan candidate has no parameter blob index")
    parameter_index = int(parameter_index)
    matches = []
    decode_errors = []
    for segment in shader_program_segments(shader):
        entries = segment["entries"]
        if program_index >= len(entries) or parameter_index >= len(entries):
            continue
        program_entry = entries[program_index]
        try:
            decoded_program = decode_program_modules(program_entry["raw"])
        except RuntimeError as error:
            decode_errors.append({
                "segmentIndex": segment["segmentIndex"],
                "error": str(error),
            })
            continue
        parameter_entry = entries[parameter_index]
        modules = decoded_program["modules"]
        stages = {row["stage"]: row for row in modules}
        pass_evidence = pass_contract(shader, candidate)
        semantic_identity_fields = {
            "vertexSpirvSha256": stages["vertex"]["sha256"],
            "fragmentSpirvSha256": stages["fragment"]["sha256"],
            "parameterEntrySha256": parameter_entry["sha256"],
            "passStateSha256": pass_evidence["passStateSha256"],
            "commonBindingsSha256": pass_evidence["commonBindingsSha256"],
        }
        identity_fields = {
            "schemaVersion": 1,
            "compilerPlatform": 18,
            "gpuProgramType": VULKAN_PROGRAM_TYPE,
            "programEntrySha256": program_entry["sha256"],
            "programContainerLayoutSha256": decoded_program["containerLayoutSha256"],
            **semantic_identity_fields,
        }
        matches.append({
            "segment": {
                key: value for key, value in segment.items() if key != "entries"
            },
            "programEntry": {
                key: value for key, value in program_entry.items() if key != "raw"
            },
            "parameterEntry": {
                key: value for key, value in parameter_entry.items() if key != "raw"
            },
            "modules": modules,
            "programContainerLayout": decoded_program["containerLayout"],
            "pass": pass_evidence,
            "identityFields": identity_fields,
            "semanticIdentityFields": semantic_identity_fields,
            "executableId": canonical_digest(identity_fields),
            "semanticExecutableId": canonical_digest(semantic_identity_fields),
        })
    unique = {row["executableId"]: row for row in matches}
    if len(unique) != 1:
        raise RuntimeError(
            f"serialized program/parameter indices resolved to {len(unique)} executable identities; "
            f"decode attempts={decode_errors}"
        )
    selected = next(iter(unique.values()))
    selected["witnessCount"] = sum(
        row["executableId"] == selected["executableId"] for row in matches
    )
    return selected


def ordered_multipass_plan(shader: dict, candidates: list[dict]) -> list[dict] | None:
    if len(candidates) < 2:
        return None
    parsed = shader.get("m_ParsedForm") or {}
    subshaders = parsed.get("m_SubShaders") or []
    ordered = sorted(candidates, key=lambda row: (row["subshader"], row["pass"]))
    if len({int(row["subshader"]) for row in ordered}) != 1:
        return None
    subshader_index = int(ordered[0]["subshader"])
    if subshader_index >= len(subshaders):
        return None
    passes = subshaders[subshader_index].get("m_Passes") or []
    # Shader variant selection is pass-local. Multiple exact-keyword candidates
    # are therefore an ordered program set, not an ambiguity, when there is
    # exactly one candidate for every serialized pass in the selected SubShader.
    # Pipeline LightMode scheduling is a separate native/runtime contract and is
    # intentionally not inferred from these serialized shader fields.
    if [int(row["pass"]) for row in ordered] != list(range(len(passes))):
        return None
    plan = []
    for ordinal, candidate in enumerate(ordered):
        pass_index = int(candidate["pass"])
        shader_pass = passes[pass_index]
        tags = {
            str(pair[0]): str(pair[1])
            for pair in ((shader_pass.get("m_Tags") or {}).get("tags") or [])
        }
        plan.append({
            "ordinal": ordinal,
            "subshader": subshader_index,
            "pass": pass_index,
            "lightMode": tags.get("LightMode"),
            "stateName": str((shader_pass.get("m_State") or {}).get("m_Name") or ""),
            "candidateWitnessId": candidate["selectorWitnessId"],
        })
    return plan


def locate_material_bundles(
    decrypted_root: Path,
    locator: dict[str, Path],
    material_cabs: set[str],
    cab_illustrations: dict[str, set[str]],
) -> set[str]:
    unresolved = set(material_cabs) - set(locator)
    card_new_root = decrypted_root / "Common" / "CardNew"
    for directory in ("Common", "Pokemon", "System", "Template"):
        root = card_new_root / directory
        for path in sorted(root.rglob("*_bundles"), key=lambda value: value.as_posix()):
            register_bundle(locator, path)
        if not (set(material_cabs) - set(locator)):
            break
    unresolved -= set(locator)

    # Some prefab PPtrs target a sibling Face bundle rather than the canonical
    # L prefab or CardNew/Common. Search only the referencing illustration roots.
    for cab in sorted(unresolved):
        for illustration_id in sorted(cab_illustrations[cab]):
            face_root = decrypted_root / "Common" / "CardNew" / "Face" / illustration_id
            for path in sorted(face_root.rglob("*_bundles"), key=lambda value: value.as_posix()):
                if path.resolve() in set(locator.values()):
                    continue
                register_bundle(locator, path)
                if cab in locator:
                    break
            if cab in locator:
                break
    locate_owner_cab_bundles(decrypted_root, locator, unresolved)
    return set(material_cabs) - set(locator)


def extract(decrypted_root: Path, include_full: bool = False) -> dict:
    decrypted_root = decrypted_root.resolve()
    face_root = decrypted_root / "Common" / "CardNew" / "Face"
    shader_root = decrypted_root / "Common" / "Shader"
    if not face_root.is_dir() or not shader_root.is_dir():
        raise RuntimeError(f"official decrypted roots are absent under {decrypted_root}")

    prefab_paths = sorted(
        face_root.glob("*/L/Prefabs/*_L.prefab_bundles"),
        key=lambda value: value.as_posix(),
    )
    usage_rows = []
    material_identities: set[str] = set()
    material_cabs: set[str] = set()
    cab_illustrations: dict[str, set[str]] = defaultdict(set)
    locator: dict[str, Path] = {}
    renderer_count = 0

    for prefab_path in prefab_paths:
        illustration_id = prefab_path.parents[2].name
        environment = UnityPy.load(str(prefab_path))
        for cab in owned_cabs(environment):
            locator[cab] = prefab_path.resolve()
        for obj in environment.objects:
            if obj.type.name != "MeshRenderer":
                continue
            renderer_count += 1
            tree = obj.read_typetree()
            renderer_identity = canonical_identity(str(obj.assets_file.name), int(obj.path_id))
            materials = tree.get("m_Materials") or []
            for slot, pointer in enumerate(materials):
                identity = pptr_identity(obj, pointer, f"{renderer_identity}.m_Materials[{slot}]")
                cab = identity.split(":", 1)[0]
                material_identities.add(identity)
                material_cabs.add(cab)
                cab_illustrations[cab].add(illustration_id)
                usage_rows.append({
                    "illustrationId": illustration_id,
                    "rendererIdentity": renderer_identity,
                    "materialSlot": slot,
                    "materialIdentity": identity,
                })
        del environment
    gc.collect()

    unresolved_cabs = locate_material_bundles(
        decrypted_root, locator, material_cabs, cab_illustrations
    )
    unresolved_materials = sorted(
        identity for identity in material_identities
        if identity.split(":", 1)[0] in unresolved_cabs
    )

    material_groups: dict[Path, list[str]] = defaultdict(list)
    for identity in sorted(material_identities):
        cab = identity.split(":", 1)[0]
        if cab in locator:
            material_groups[locator[cab]].append(identity)

    materials = []
    shader_identities: set[str] = set()
    for bundle, identities in sorted(material_groups.items(), key=lambda row: row[0].as_posix()):
        environment = UnityPy.load(str(bundle))
        objects = object_map(environment)
        for identity in identities:
            cab, path_id_text = identity.split(":", 1)
            obj = objects.get((cab, int(path_id_text)))
            if obj is None:
                raise RuntimeError(f"Material {identity} is absent from located bundle {bundle}")
            if obj.type.name != "Material":
                raise RuntimeError(f"official object {identity} is {obj.type.name}, expected Material")
            record = material_record(obj, bundle, decrypted_root)
            materials.append(record)
            shader_identities.add(record["shaderIdentity"])
        del environment
    gc.collect()

    shader_locator: dict[str, Path] = {}
    for path in sorted(shader_root.rglob("*_bundles"), key=lambda value: value.as_posix()):
        register_bundle(shader_locator, path)
    missing_shader_cabs = sorted({identity.split(":", 1)[0] for identity in shader_identities} - set(shader_locator))
    if missing_shader_cabs:
        raise RuntimeError(f"official Shader CABs are not located: {missing_shader_cabs}")

    shader_groups: dict[Path, list[str]] = defaultdict(list)
    for identity in sorted(shader_identities):
        shader_groups[shader_locator[identity.split(":", 1)[0]]].append(identity)
    shaders = []
    shader_trees = {}
    for bundle, identities in sorted(shader_groups.items(), key=lambda row: row[0].as_posix()):
        environment = UnityPy.load(str(bundle))
        objects = object_map(environment)
        for identity in identities:
            cab, path_id_text = identity.split(":", 1)
            obj = objects.get((cab, int(path_id_text)))
            if obj is None or obj.type.name != "Shader":
                actual = None if obj is None else obj.type.name
                raise RuntimeError(f"official Shader {identity} resolved to {actual}")
            compact, tree = shader_record(obj, bundle, decrypted_root)
            shaders.append(compact)
            shader_trees[identity] = tree
        del environment
    gc.collect()

    selectors_by_key = {}
    materials_by_selector: dict[str, list[str]] = defaultdict(list)
    for material in materials:
        key = canonical_digest([material["shaderIdentity"], material["keywords"]])
        materials_by_selector[key].append(material["identity"])
        if key in selectors_by_key:
            continue
        candidates, unknown_keywords = static_vulkan_candidates(
            shader_trees[material["shaderIdentity"]], tuple(material["keywords"])
        )
        candidate_selection = "exact-keywords"
        if not candidates and not unknown_keywords:
            candidates, unknown_keywords = native_best_match_vulkan_candidates(
                shader_trees[material["shaderIdentity"]], tuple(material["keywords"])
            )
            if candidates:
                candidate_selection = "native-best-match"
        selectors_by_key[key] = {
            "selectorId": key,
            "shaderIdentity": material["shaderIdentity"],
            "keywords": material["keywords"],
            "unknownKeywords": unknown_keywords,
            "candidateSelection": candidate_selection,
            "candidates": candidates,
        }
    material_by_identity = {material["identity"]: material for material in materials}
    material_usage_counts: dict[str, int] = defaultdict(int)
    for usage in usage_rows:
        material_usage_counts[usage["materialIdentity"]] += 1
    shader_by_identity = {shader["identity"]: shader for shader in shaders}
    selectors = []
    for key in sorted(selectors_by_key):
        row = selectors_by_key[key]
        selector_material_ids = sorted(materials_by_selector[key])
        instancing_material_ids = [
            identity for identity in selector_material_ids
            if material_by_identity[identity]["enableInstancingVariants"]
        ]
        row["materialCount"] = len(selector_material_ids)
        row["materialSlotUsages"] = sum(
            material_usage_counts[identity] for identity in selector_material_ids
        )
        row["materialIdentitiesSha256"] = canonical_digest(selector_material_ids)
        row["instancingMaterialCount"] = len(instancing_material_ids)
        row["runtimeEngineVariantBoundary"] = bool(instancing_material_ids)
        for candidate in row["candidates"]:
            witness_fields = {
                "shaderIdentity": row["shaderIdentity"],
                "shaderObjectSha256": shader_by_identity[row["shaderIdentity"]]["rawSha256"],
                "platformIndex": 0,
                "platformValue": 18,
                "segmentIndex": 0,
                "subshaderIndex": candidate["subshader"],
                "passIndex": candidate["pass"],
                "stageContainers": candidate["stages"],
                "keywordIndices": candidate["keywordIndices"],
                "keywords": candidate["keywords"],
                "gpuProgramType": candidate["gpuProgramType"],
                "shaderRequirements": candidate["shaderRequirements"],
                "programBlobIndex": candidate["programBlobIndex"],
                "parameterBlobIndex": candidate["parameterBlobIndex"],
            }
            if row["candidateSelection"] == "native-best-match":
                witness_fields["serializedOrder"] = candidate["serializedOrder"]
                witness_fields["nativeBestMatch"] = candidate["nativeBestMatch"]
            candidate["selectorWitnessId"] = canonical_digest(witness_fields)
        row["selectorWitnessId"] = (
            row["candidates"][0]["selectorWitnessId"]
            if len(row["candidates"]) == 1 else None
        )
        if row["candidateSelection"] == "native-best-match" and row["candidates"]:
            row["selectionMode"] = "native-best-match"
        elif len(row["candidates"]) == 1:
            row["selectionMode"] = "unique-exact-keywords"
        else:
            multipass = ordered_multipass_plan(
                shader_trees[row["shaderIdentity"]], row["candidates"]
            )
            disabled_passes = {
                value
                for identity in selector_material_ids
                for value in material_by_identity[identity]["disabledShaderPasses"]
            }
            if multipass is not None and not disabled_passes:
                row["selectionMode"] = "ordered-multipass-structure"
                row["orderedPasses"] = multipass
            elif row["candidates"]:
                row["selectionMode"] = "ambiguous"
            else:
                row["selectionMode"] = "no-exact-keyword-match"

        if row["selectionMode"] in {
            "unique-exact-keywords", "ordered-multipass-structure", "native-best-match"
        }:
            row["staticExecutables"] = []
            row["staticExecutableErrors"] = []
            for candidate in row["candidates"]:
                try:
                    executable = resolve_static_executable(
                        shader_trees[row["shaderIdentity"]], candidate
                    )
                    row["staticExecutables"].append({
                        "candidateWitnessId": candidate["selectorWitnessId"],
                        "subshader": candidate["subshader"],
                        "pass": candidate["pass"],
                        "executable": executable,
                    })
                except RuntimeError as error:
                    row["staticExecutableErrors"].append({
                        "candidateWitnessId": candidate["selectorWitnessId"],
                        "error": str(error),
                    })
            if not row["staticExecutableErrors"]:
                del row["staticExecutableErrors"]
            if len(row["staticExecutables"]) == 1:
                row["staticExecutable"] = row["staticExecutables"][0]["executable"]
        selectors.append(row)

    def exceptional_selector(row: dict) -> dict:
        material_rows = [
            material_by_identity[identity]
            for identity in sorted(materials_by_selector[row["selectorId"]])
        ]
        return {
            **row,
            "shaderName": shader_by_identity[row["shaderIdentity"]]["name"],
            "materials": [{
                "identity": material["identity"],
                "name": material["name"],
                "customRenderQueue": material["customRenderQueue"],
            } for material in material_rows],
        }

    ambiguous = [
        exceptional_selector(row) for row in selectors
        if row["selectionMode"] == "ambiguous"
    ]
    unmatched = [
        exceptional_selector(row) for row in selectors
        if row["selectionMode"] == "no-exact-keyword-match"
    ]
    exact = [row for row in selectors if row["selectionMode"] == "unique-exact-keywords"]
    ordered_multipass = [
        row for row in selectors if row["selectionMode"] == "ordered-multipass-structure"
    ]
    native_best_match = [
        row for row in selectors if row["selectionMode"] == "native-best-match"
    ]
    executable_errors = [
        exceptional_selector(row) for row in selectors if row.get("staticExecutableErrors")
    ]
    executable_selectors = [
        row for row in selectors
        if row.get("staticExecutables") and not row.get("staticExecutableErrors")
    ]
    runtime_engine_variant_selectors = [
        row for row in selectors if row["runtimeEngineVariantBoundary"]
    ]
    executables_by_id = {}
    semantic_executables_by_id = {}
    for row in executable_selectors:
        for item in row["staticExecutables"]:
            executable = item["executable"]
            usage = {
                "selectorId": row["selectorId"],
                "candidateWitnessId": item["candidateWitnessId"],
                "subshader": item["subshader"],
                "pass": item["pass"],
            }
            archetype = executables_by_id.setdefault(executable["executableId"], {
                "executableId": executable["executableId"],
                "semanticExecutableId": executable["semanticExecutableId"],
                "identityFields": executable["identityFields"],
                "usages": [],
            })
            archetype["usages"].append(usage)
            semantic = semantic_executables_by_id.setdefault(
                executable["semanticExecutableId"], {
                    "semanticExecutableId": executable["semanticExecutableId"],
                    "identityFields": executable["semanticIdentityFields"],
                    "officialExecutableIds": set(),
                }
            )
            semantic["officialExecutableIds"].add(executable["executableId"])
    executables = []
    for executable_id in sorted(executables_by_id):
        row = executables_by_id[executable_id]
        row["usages"].sort(key=lambda value: (
            value["selectorId"], value["subshader"], value["pass"]
        ))
        row["selectorCount"] = len({value["selectorId"] for value in row["usages"]})
        executables.append(row)
    semantic_executables = []
    for executable_id in sorted(semantic_executables_by_id):
        row = semantic_executables_by_id[executable_id]
        row["officialExecutableIds"] = sorted(row["officialExecutableIds"])
        semantic_executables.append(row)
    port_index = []
    for selector in selectors:
        for item in selector.get("staticExecutables") or []:
            executable = item["executable"]
            port_index.append({
                "selectorId": selector["selectorId"],
                "shaderIdentity": selector["shaderIdentity"],
                "shaderName": shader_by_identity[selector["shaderIdentity"]]["name"],
                "keywords": selector["keywords"],
                "selectionMode": selector["selectionMode"],
                "runtimeEngineVariantBoundary": selector["runtimeEngineVariantBoundary"],
                "candidateWitnessId": item["candidateWitnessId"],
                "subshader": item["subshader"],
                "pass": item["pass"],
                "executableId": executable["executableId"],
                "semanticExecutableId": executable["semanticExecutableId"],
                "identityFields": executable["semanticIdentityFields"],
                "materialCount": selector["materialCount"],
                "materialSlotUsages": selector["materialSlotUsages"],
            })
    port_index.sort(key=lambda row: (
        row["selectorId"], row["subshader"], row["pass"], row["candidateWitnessId"]
    ))
    instancing_materials = sorted(
        material["identity"] for material in materials
        if material["enableInstancingVariants"]
    )
    state_archetypes = sorted({
        canonical_digest([
            material["shaderIdentity"],
            material["keywords"],
            material["customRenderQueue"],
            material["disabledShaderPasses"],
            material["enableInstancingVariants"],
        ])
        for material in materials
    })

    source_bundle_rows = sorted({
        (material["sourceBundle"], material["sourceBundleSha256"])
        for material in materials
    } | {
        (shader["sourceBundle"], shader["sourceBundleSha256"])
        for shader in shaders
    })
    unresolved_usage = defaultdict(int)
    for row in usage_rows:
        if row["materialIdentity"] in unresolved_materials:
            unresolved_usage[row["materialIdentity"]] += 1
    exceptional = {
        "unresolvedMaterialCabs": [{
            "cab": cab,
            "illustrationIds": sorted(cab_illustrations[cab]),
            "materialIdentities": sorted(
                identity for identity in unresolved_materials if identity.startswith(f"{cab}:")
            ),
            "materialSlotUsages": sum(
                unresolved_usage[identity]
                for identity in unresolved_materials
                if identity.startswith(f"{cab}:")
            ),
        } for cab in sorted(unresolved_cabs)],
        "unresolvedMaterials": unresolved_materials,
        "ambiguousSelectors": ambiguous,
        "unmatchedSelectors": unmatched,
        "orderedMultipassSelectors": [
            exceptional_selector(row) for row in ordered_multipass
        ],
        "nativeBestMatchSelectors": [
            exceptional_selector(row) for row in native_best_match
        ],
        "executableResolutionErrors": executable_errors,
        "runtimeEngineVariantSelectors": [
            exceptional_selector(row) for row in runtime_engine_variant_selectors
        ],
        "instancingMaterials": instancing_materials,
    }
    digests = {
        "usageRowsSha256": canonical_digest(usage_rows),
        "materialsSha256": canonical_digest(materials),
        "shadersSha256": canonical_digest(shaders),
        "selectorsSha256": canonical_digest(selectors),
        "executablesSha256": canonical_digest(executables),
        "semanticExecutablesSha256": canonical_digest(semantic_executables),
        "portIndexSha256": canonical_digest(port_index),
        "stateArchetypesSha256": canonical_digest(state_archetypes),
        "sourceBundlesSha256": canonical_digest(source_bundle_rows),
        "exceptionalSha256": canonical_digest(exceptional),
        "nativeVariantSelectionSha256": canonical_digest(NATIVE_VARIANT_SELECTION),
    }
    digests["proofGraphSha256"] = canonical_digest(digests)
    output = {
        "schema": SCHEMA,
        "schemaVersion": 4,
        "unityVersion": UNITY_VERSION,
        "source": {
            "decryptedRoot": decrypted_root.as_posix(),
            "definition": "serialized Face L MeshRenderer slots -> Material -> Shader -> static Vulkan candidates",
            "excludedInputs": ["scene JSON", "render recipe", "PNG", "GLB", "screenshot"],
            "nativeVariantSelection": NATIVE_VARIANT_SELECTION,
        },
        "summary": {
            "lPrefabs": len(prefab_paths),
            "meshRenderers": renderer_count,
            "materialSlotUsages": len(usage_rows),
            "uniqueMaterials": len(material_identities),
            "resolvedMaterials": len(materials),
            "uniqueShaders": len(shaders),
            "selectorArchetypes": len(selectors),
            "exactStaticSelectors": len(exact),
            "exactExecutableSelectors": len(executable_selectors),
            "exactExecutableCandidates": sum(
                len(row["staticExecutables"]) for row in executable_selectors
            ),
            "executableResolutionErrors": len(executable_errors),
            "executableArchetypes": len(executables),
            "semanticExecutableArchetypes": len(semantic_executables),
            "orderedMultipassSelectors": len(ordered_multipass),
            "nativeBestMatchSelectors": len(native_best_match),
            "runtimeEngineVariantSelectors": len(runtime_engine_variant_selectors),
            "ambiguousStaticSelectors": len(ambiguous),
            "unmatchedStaticSelectors": len(unmatched),
            "stateArchetypes": len(state_archetypes),
            "instancingMaterials": len(instancing_materials),
        },
        "exceptional": exceptional,
        "digests": digests,
        "portIndex": port_index,
    }
    if include_full:
        output["proofGraph"] = {
            "usageRows": usage_rows,
            "materials": materials,
            "shaders": shaders,
            "selectors": selectors,
            "executables": executables,
            "semanticExecutables": semantic_executables,
            "portIndex": port_index,
            "stateArchetypes": state_archetypes,
            "sourceBundles": source_bundle_rows,
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = extract(args.decrypted_root, include_full=args.full)
    encoded = json.dumps(
        result,
        ensure_ascii=True,
        indent=2 if args.pretty else None,
        separators=None if args.pretty else (",", ":"),
    ) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="ascii")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
