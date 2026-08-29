#!/usr/bin/env python3
"""Extract official per-material MRT output evidence from four card prefabs.

The chain is intentionally source-to-bytecode: MeshRenderer material PPtrs in
the L prefabs, Material shader PPtrs and complete enabled keyword sets, then
the exact Vulkan (GpuProgramType 25) ShaderProgram blob entry. Fragment output
classification is performed on SPIR-V recovered from that exact entry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import lz4.block
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import warnings

try:
    import UnityPy
except ImportError as exc:
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc


ROOT = Path(__file__).resolve().parents[1]
SHADERDEC = ROOT / "build" / "shaderdec"
sys.path.insert(0, str(SHADERDEC))
import smolv  # noqa: E402


UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get(
    "PCR_UNITY_VERSION",
    "2022.3.62f2",
)
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")

DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
OFFICIAL_CARDS = (
    "cPK_10_000040_00_FUSHIGIBANAex_RR",
    "cPK_20_008900_02_HOUOUex_UR",
    "cTR_20_000230_00_LEAF_SR",
    "cTR_20_000670_00_IIBUINOBAKKU_UR",
)
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
SHADER_STAGES = (
    "progVertex",
    "progFragment",
    "progGeometry",
    "progHull",
    "progDomain",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def as_pair_map(items: object) -> dict[str, object]:
    output: dict[str, object] = {}
    for item in items or []:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            key, value = item
        elif isinstance(item, dict):
            key, value = item.get("first"), item.get("second")
        else:
            continue
        if key is not None:
            output[str(key)] = value
    return output


def enabled_keywords(material: dict) -> list[str]:
    legacy = material.get("m_ShaderKeywords") or ""
    if isinstance(legacy, str):
        legacy_keywords = legacy.split()
    else:
        legacy_keywords = list(legacy or [])
    valid = list(material.get("m_ValidKeywords") or [])
    return sorted({str(keyword) for keyword in legacy_keywords + valid if keyword})


def prefab_bundle(decrypted_root: Path, card_id: str) -> Path:
    legacy = (
        decrypted_root
        / "Common"
        / "CardNew"
        / "Face"
        / card_id
        / "L"
        / "Prefabs"
        / f"{card_id}_L.prefab_bundles"
    )
    if legacy.is_file():
        return legacy

    face_root = decrypted_root / "Common" / "CardNew" / "Face"
    matches = sorted(
        path.resolve()
        for path in face_root.rglob(f"{card_id}_L.prefab_bundles")
        if path.parent.name == "Prefabs"
        and path.parent.parent.name == "L"
        and path.parent.parent.parent.name == card_id
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"expected one official L prefab bundle for {card_id} under "
            f"{face_root}, found {len(matches)}"
        )
    return matches[0]


class OfficialBundleIndex:
    def __init__(self, decrypted_root: Path):
        self.decrypted_root = decrypted_root
        self.cab_paths: dict[str, Path] = {}
        self.loaded: dict[Path, tuple[object, dict[tuple[str, int], object]]] = {}
        self.hashes: dict[Path, str] = {}

    def register(self, path: Path) -> None:
        path = path.resolve()
        try:
            environment = UnityPy.load(str(path))
        except Exception as error:
            raise RuntimeError(f"failed to load official bundle {path}: {error}") from error
        cabs = sorted({str(obj.assets_file.name) for obj in environment.objects})
        if not cabs:
            raise RuntimeError(f"bundle has no serialized CAB: {path}")
        for cab in cabs:
            previous = self.cab_paths.get(cab)
            if previous is not None and previous != path:
                raise RuntimeError(f"duplicate CAB {cab}: {previous} and {path}")
            self.cab_paths[cab] = path

    def build(self, prefabs: list[Path]) -> None:
        roots = (
            self.decrypted_root / "Common" / "CardNew" / "Common",
            self.decrypted_root / "Common" / "Shader",
        )
        paths = set(prefabs)
        for root in roots:
            paths.update(root.rglob("*_bundles"))
        for path in sorted(paths):
            self.register(path)

    def load(self, path: Path) -> tuple[object, dict[tuple[str, int], object]]:
        path = path.resolve()
        if path not in self.loaded:
            environment = UnityPy.load(str(path))
            objects = {
                (str(obj.assets_file.name), int(obj.path_id)): obj
                for obj in environment.objects
            }
            self.loaded[path] = (environment, objects)
        return self.loaded[path]

    def bundle_hash(self, path: Path) -> str:
        path = path.resolve()
        if path not in self.hashes:
            self.hashes[path] = sha256_file(path)
        return self.hashes[path]

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.decrypted_root).as_posix()

    def resolve(self, source_obj: object, source_bundle: Path, pointer: dict) -> tuple[object, Path, dict]:
        file_id = int(pointer.get("m_FileID", 0))
        path_id = int(pointer.get("m_PathID", 0))
        if path_id == 0:
            raise RuntimeError("encountered a null PPtr")

        if file_id == 0:
            cab = str(source_obj.assets_file.name)
            target_bundle = source_bundle.resolve()
        else:
            externals = source_obj.assets_file.externals
            if file_id < 1 or file_id > len(externals):
                raise RuntimeError(
                    f"PPtr file id {file_id} is outside {source_obj.assets_file.name} externals"
                )
            cab = str(externals[file_id - 1].name)
            target_bundle = self.cab_paths.get(cab)
            if target_bundle is None:
                raise RuntimeError(f"external CAB {cab} is not present under official roots")

        _, objects = self.load(target_bundle)
        target = objects.get((cab, path_id))
        if target is None:
            raise RuntimeError(
                f"PPtr {file_id}:{path_id} resolved to missing {cab} object in {target_bundle}"
            )
        evidence = {
            "sourceCab": str(source_obj.assets_file.name),
            "fileId": file_id,
            "pathId": str(path_id),
            "targetCab": cab,
            "targetBundle": self.relative(target_bundle),
            "targetBundleSha256": self.bundle_hash(target_bundle),
        }
        return target, target_bundle, evidence


def spirv_execution_model(module: bytes) -> int:
    if len(module) < 24 or len(module) % 4:
        return -1
    words = struct.unpack(f"<{len(module) // 4}I", module)
    cursor = 5
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length == 0:
            break
        if opcode == 15 and cursor + 1 < len(words):
            return int(words[cursor + 1])
        cursor += length
    return -1


def trim_spirv(module: bytes) -> bytes:
    words = struct.unpack(f"<{len(module) // 4}I", module)
    cursor = 5
    end = None
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length == 0:
            break
        if opcode == 56:
            end = cursor + length
        cursor += length
    if end is None:
        return module
    return struct.pack(f"<{end}I", *words[:end])


def nested_row(values: list, index: int) -> list:
    value = values[index]
    return value if isinstance(value, list) else [value]


def decompress_vulkan_modules(shader: dict, blob_index: int) -> list[bytes]:
    platforms = [int(value) for value in shader.get("platforms", [])]
    if VULKAN_PLATFORM not in platforms:
        raise RuntimeError(f"shader has no Vulkan platform {VULKAN_PLATFORM}: {platforms}")
    platform_index = platforms.index(VULKAN_PLATFORM)
    offsets = nested_row(shader.get("offsets", []), platform_index)
    compressed_lengths = nested_row(shader.get("compressedLengths", []), platform_index)
    decompressed_lengths = nested_row(shader.get("decompressedLengths", []), platform_index)
    if not (len(offsets) == len(compressed_lengths) == len(decompressed_lengths)):
        raise RuntimeError("Vulkan compressed shader segment arrays have different lengths")

    compressed_blob = bytes(shader.get("compressedBlob", []))
    modules: list[bytes] = []
    for offset, compressed_length, decompressed_length in zip(
        offsets, compressed_lengths, decompressed_lengths
    ):
        compressed = compressed_blob[int(offset) : int(offset) + int(compressed_length)]
        decoded = lz4.block.decompress(compressed, uncompressed_size=int(decompressed_length))
        if len(decoded) < 4:
            continue
        count = struct.unpack_from("<I", decoded, 0)[0]
        table_end = 4 + count * 12
        if table_end > len(decoded) or blob_index >= count:
            continue
        entry_offset, entry_length, _ = struct.unpack_from("<III", decoded, 4 + blob_index * 12)
        if entry_offset + entry_length > len(decoded):
            raise RuntimeError(f"ShaderProgram blob entry {blob_index} is out of bounds")
        entry = decoded[entry_offset : entry_offset + entry_length]
        modules.extend(trim_spirv(module) for _, module in smolv.find_and_decode(entry) if module)
    return modules


def decompress_vulkan_stage(shader: dict, blob_index: int, execution_model: int) -> bytes:
    modules = [
        module for module in decompress_vulkan_modules(shader, blob_index)
        if spirv_execution_model(module) == execution_model
    ]
    stage_name = {0: "vertex", 4: "fragment"}.get(execution_model, str(execution_model))
    if len(modules) != 1:
        raise RuntimeError(
            f"GpuProgramType {SPIRV_PROGRAM_TYPE} blob {blob_index} yielded "
            f"{len(modules)} {stage_name} SPIR-V modules"
        )
    return modules[0]


def decompress_vulkan_program(shader: dict, blob_index: int) -> bytes:
    fragments = [
        module for module in decompress_vulkan_modules(shader, blob_index)
        if spirv_execution_model(module) == 4
    ]
    if len(fragments) != 1:
        raise RuntimeError(
            f"GpuProgramType {SPIRV_PROGRAM_TYPE} blob {blob_index} yielded "
            f"{len(fragments)} fragment SPIR-V modules"
        )
    return fragments[0]


def spirv_specialization_count(module: bytes) -> int:
    module = trim_spirv(module)
    words = struct.unpack(f"<{len(module) // 4}I", module)
    spec_ids = set()
    cursor = 5
    while cursor < len(words):
        instruction = words[cursor]
        length = instruction >> 16
        opcode = instruction & 0xFFFF
        if length == 0 or cursor + length > len(words):
            raise RuntimeError("malformed SPIR-V instruction while reading specialization constants")
        # OpDecorate %target SpecId literal
        if opcode == 71 and length >= 4 and words[cursor + 2] == 1:
            spec_ids.add(words[cursor + 1])
        cursor += length
    return len(spec_ids)


def exact_vulkan_variant(shader: dict, material_keywords: list[str]) -> dict:
    parsed = shader.get("m_ParsedForm", {})
    keyword_names = list(parsed.get("m_KeywordNames", []))
    unknown = sorted(set(material_keywords) - set(keyword_names))
    if unknown:
        raise RuntimeError(f"material keywords absent from Shader keyword table: {unknown}")

    matches = []
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders", [])):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes", [])):
            for stage_name in SHADER_STAGES:
                stage = shader_pass.get(stage_name, {})
                for group_index, group in enumerate(stage.get("m_PlayerSubPrograms", [])):
                    for record in group or []:
                        if int(record.get("m_GpuProgramType", -1)) != SPIRV_PROGRAM_TYPE:
                            continue
                        indices = [int(value) for value in record.get("m_KeywordIndices", [])]
                        try:
                            compiled = sorted(keyword_names[index] for index in indices)
                        except IndexError as exc:
                            raise RuntimeError("compiled shader keyword index is out of range") from exc
                        if compiled == material_keywords:
                            matches.append(
                                {
                                    "subshader": subshader_index,
                                    "pass": pass_index,
                                    "stage": stage_name,
                                    "playerGroup": group_index,
                                    "blobIndex": int(record.get("m_BlobIndex")),
                                    "gpuProgramType": int(record.get("m_GpuProgramType")),
                                    "keywordIndices": indices,
                                    "keywords": compiled,
                                }
                            )
    unique = {
        (row["subshader"], row["pass"], row["blobIndex"], tuple(row["keywords"])): row
        for row in matches
    }
    if len(unique) != 1:
        raise RuntimeError(
            f"complete keyword set {material_keywords} matched {len(unique)} Vulkan variants"
        )
    return next(iter(unique.values()))


def all_vulkan_fragment_variants(shader: dict) -> list[dict]:
    """Return every compiled Vulkan fragment program in one official Shader.

    Unity may add engine-owned keywords such as INSTANCING_ON at runtime even
    when they are absent from Material.m_ValidKeywords.  The serialized exact
    selection remains the static baseline; this complete table lets a runtime
    capture select the byte-identical program without guessing that keyword.
    """
    parsed = shader.get("m_ParsedForm", {})
    keyword_names = list(parsed.get("m_KeywordNames", []))
    candidates: dict[tuple, dict] = {}
    module_cache: dict[int, bytes] = {}
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders", [])):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes", [])):
            for stage_name in SHADER_STAGES:
                stage = shader_pass.get(stage_name, {})
                for group_index, group in enumerate(stage.get("m_PlayerSubPrograms", [])):
                    for record in group or []:
                        if int(record.get("m_GpuProgramType", -1)) != SPIRV_PROGRAM_TYPE:
                            continue
                        indices = tuple(int(value) for value in record.get("m_KeywordIndices", []))
                        try:
                            compiled = tuple(sorted(keyword_names[index] for index in indices))
                        except IndexError as exc:
                            raise RuntimeError("compiled shader keyword index is out of range") from exc
                        blob_index = int(record.get("m_BlobIndex"))
                        key = (subshader_index, pass_index, blob_index, compiled)
                        if key in candidates:
                            continue
                        if blob_index not in module_cache:
                            module_cache[blob_index] = decompress_vulkan_program(shader, blob_index)
                        module = module_cache[blob_index]
                        vertex = decompress_vulkan_stage(shader, blob_index, 0)
                        candidates[key] = {
                            "subshader": subshader_index,
                            "pass": pass_index,
                            "stageMetadata": stage_name,
                            "playerGroup": group_index,
                            "blobIndex": blob_index,
                            "gpuProgramType": SPIRV_PROGRAM_TYPE,
                            "keywordIndices": list(indices),
                            "compiledKeywords": list(compiled),
                            "fragmentSpvSha256": sha256_bytes(module),
                            "fragmentSpvBytes": len(module),
                            "fragmentSpecializationCount": spirv_specialization_count(module),
                            "vertexSpvSha256": sha256_bytes(vertex),
                            "vertexSpvBytes": len(vertex),
                            "vertexSpecializationCount": spirv_specialization_count(vertex),
                        }
    return [candidates[key] for key in sorted(candidates)]


def shader_constant_buffers(shader: dict) -> list[dict]:
    parsed = shader.get("m_ParsedForm", {})
    output: dict[tuple, dict] = {}
    for subshader in parsed.get("m_SubShaders", []):
        for shader_pass in subshader.get("m_Passes", []):
            names = {int(index): name for name, index in shader_pass.get("m_NameIndices", [])}
            for stage_name in SHADER_STAGES:
                common = shader_pass.get(stage_name, {}).get("m_CommonParameters", {})
                for buffer in common.get("m_ConstantBuffers", []):
                    vectors = sorted(
                        (
                            {
                                "name": names.get(int(item.get("m_NameIndex", -1))),
                                "offset": int(item.get("m_Index", -1)),
                                "dim": int(item.get("m_Dim", 0)),
                            }
                            for item in buffer.get("m_VectorParams", [])
                        ),
                        key=lambda item: (item["offset"], item["name"] or ""),
                    )
                    row = {
                        "name": names.get(int(buffer.get("m_NameIndex", -1))),
                        "size": int(buffer.get("m_Size", -1)),
                        "vectors": vectors,
                    }
                    key = (
                        row["name"],
                        row["size"],
                        tuple((item["name"], item["offset"], item["dim"]) for item in vectors),
                    )
                    output[key] = row
    return list(output.values())


def run_spirv_cross(module: bytes, temporary: Path) -> tuple[dict, str]:
    spv_path = temporary / f"{sha256_bytes(module)}.spv"
    spv_path.write_bytes(trim_spirv(module))
    reflection = json.loads(
        subprocess.check_output(
            ["spirv-cross", str(spv_path), "--reflect"],
            text=True,
            encoding="utf-8",
        )
    )
    glsl = subprocess.check_output(
        ["spirv-cross", str(spv_path), "--version", "300", "--es"],
        text=True,
        encoding="utf-8",
    )
    return reflection, glsl


ZERO_VEC4 = re.compile(r"^vec4\(0(?:\.0)?\)$")


def output_assignments(glsl: str, output_name: str) -> list[tuple[int, str]]:
    pattern = re.compile(rf"\b{re.escape(output_name)}\s*=\s*([^;]+);")
    return [(match.start(), match.group(1).strip()) for match in pattern.finditer(glsl)]


def reflection_member_property(
    shader: dict,
    reflection: dict,
    glsl: str,
    instance_name: str,
    member_name: str,
) -> str:
    declaration = re.search(
        rf"\buniform\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{{[\s\S]*?\}}\s*{re.escape(instance_name)}\s*;",
        glsl,
    )
    if not declaration:
        raise RuntimeError(f"cannot resolve GLSL uniform block instance {instance_name}")
    block_name = declaration.group(1)
    ubos = [ubo for ubo in reflection.get("ubos", []) if ubo.get("name") == block_name]
    if len(ubos) != 1:
        raise RuntimeError(f"uniform block {block_name} has {len(ubos)} reflection records")
    ubo = ubos[0]
    type_info = reflection.get("types", {}).get(ubo.get("type"), {})
    members = [member for member in type_info.get("members", []) if member.get("name") == member_name]
    if len(members) != 1:
        raise RuntimeError(f"uniform member {block_name}.{member_name} is ambiguous")
    offset = int(members[0].get("offset", -1))
    block_size = int(ubo.get("block_size", -1))

    candidates = set()
    for buffer in shader_constant_buffers(shader):
        if buffer["size"] != block_size:
            continue
        for vector in buffer["vectors"]:
            if vector["offset"] == offset and vector["name"]:
                candidates.add(vector["name"])
    if len(candidates) != 1:
        raise RuntimeError(
            f"official constant-buffer offset {block_size}:{offset} maps to {sorted(candidates)}"
        )
    return next(iter(candidates))


def formula_zero_gate(
    shader: dict,
    reflection: dict,
    glsl: str,
    output_name: str,
    assignments: list[tuple[int, str]],
) -> str | None:
    nonzero = [(index, rhs) for index, rhs in assignments if not ZERO_VEC4.fullmatch(rhs)]
    if len(nonzero) != 1:
        return None
    assignment_index, rhs = nonzero[0]
    source_match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)", rhs)
    if not source_match:
        return None
    source = source_match.group(1)
    before = glsl[:assignment_index]
    for component in "xyz":
        component_zero = re.compile(
            rf"\b{re.escape(source)}\.{component}\s*=\s*0(?:\.0)?\s*;"
        )
        if not component_zero.search(before):
            return None

    writes = list(
        re.finditer(rf"\b{re.escape(source)}\.w\s*(\*=|=)\s*([^;]+);", before)
    )
    if not writes:
        return None
    write = writes[-1]
    operator, expression = write.group(1), write.group(2)
    if operator != "*=" and "*" not in expression:
        return None
    uniform_members = sorted(
        set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\.(_m[0-9]+)\b", expression))
    )
    properties = {
        reflection_member_property(shader, reflection, glsl, instance, member)
        for instance, member in uniform_members
    }
    if len(properties) != 1:
        return None
    return next(iter(properties))


def classify_fragment(shader: dict, module: bytes, temporary: Path) -> dict:
    reflection, glsl = run_spirv_cross(module, temporary)
    outputs = sorted(
        (
            {"name": item.get("name"), "location": int(item.get("location", -1))}
            for item in reflection.get("outputs", [])
        ),
        key=lambda item: item["location"],
    )
    location_zero = [item for item in outputs if item["location"] == 0]
    if len(location_zero) != 1:
        raise RuntimeError(f"fragment has {len(location_zero)} location-0 outputs")
    location_one = [item for item in outputs if item["location"] == 1]
    if not location_one:
        return {
            "outputs": outputs,
            "classification": "location0-only",
            "assignments": [],
            "zeroGateProperty": None,
        }
    if len(location_one) != 1:
        raise RuntimeError(f"fragment has {len(location_one)} location-1 outputs")

    output_name = str(location_one[0]["name"])
    assignments = output_assignments(glsl, output_name)
    if not assignments:
        raise RuntimeError(f"location-1 output {output_name} has no assignment")
    fixed_zero = all(ZERO_VEC4.fullmatch(rhs) for _, rhs in assignments)
    zero_gate = None
    if not fixed_zero:
        zero_gate = formula_zero_gate(shader, reflection, glsl, output_name, assignments)
    return {
        "outputs": outputs,
        "classification": "fixed-zero" if fixed_zero else "formula",
        "assignments": [rhs for _, rhs in assignments],
        "zeroGateProperty": zero_gate,
    }


def material_properties(material: dict) -> dict[str, float]:
    values = as_pair_map((material.get("m_SavedProperties") or {}).get("m_Floats", []))
    values.update(as_pair_map((material.get("m_SavedProperties") or {}).get("m_Ints", [])))
    return {name: float(value) for name, value in values.items()}


def variant_key(shader_name: str, keywords: list[str]) -> str:
    return f"{shader_name}|{','.join(keywords)}"


def extract(decrypted_root: Path) -> dict:
    if not shutil.which("spirv-cross"):
        raise RuntimeError("spirv-cross is required on PATH")
    prefabs = [prefab_bundle(decrypted_root, card_id) for card_id in OFFICIAL_CARDS]
    missing = [path for path in prefabs if not path.is_file()]
    if missing:
        raise RuntimeError(f"official prefab bundle missing: {missing[0]}")

    index = OfficialBundleIndex(decrypted_root)
    index.build(prefabs)
    cards = []
    variants: dict[str, dict] = {}
    renderer_shader_names = set()

    for card_id, path in zip(OFFICIAL_CARDS, prefabs):
        _, prefab_objects = index.load(path)
        renderers = [
            obj
            for obj in prefab_objects.values()
            if obj.type.name == "MeshRenderer"
        ]
        material_ref_count = 0
        for renderer in sorted(renderers, key=lambda obj: int(obj.path_id)):
            renderer_tree = renderer.read_typetree()
            for slot, pointer in enumerate(renderer_tree.get("m_Materials", [])):
                material_ref_count += 1
                material_obj, material_bundle, material_pptr = index.resolve(renderer, path, pointer)
                if material_obj.type.name != "Material":
                    raise RuntimeError(
                        f"MeshRenderer {renderer.path_id} slot {slot} resolved to {material_obj.type.name}"
                    )
                material = material_obj.read_typetree()
                keywords = enabled_keywords(material)
                shader_pointer = material.get("m_Shader") or {}
                shader_obj, shader_bundle, shader_pptr = index.resolve(
                    material_obj, material_bundle, shader_pointer
                )
                if shader_obj.type.name != "Shader":
                    raise RuntimeError(f"Material {material.get('m_Name')} shader PPtr is {shader_obj.type.name}")
                shader = shader_obj.read_typetree()
                shader_name = str((shader.get("m_ParsedForm") or {}).get("m_Name", ""))
                if not shader_name:
                    raise RuntimeError(f"Material {material.get('m_Name')} resolved an unnamed Shader")
                renderer_shader_names.add(shader_name)
                key = variant_key(shader_name, keywords)
                identity = (
                    str(material_obj.assets_file.name),
                    int(material_obj.path_id),
                )
                row = variants.setdefault(
                    key,
                    {
                        "key": key,
                        "shader": shader_name,
                        "shortShader": shader_name.split("/")[-1],
                        "materialKeywords": keywords,
                        "shaderObject": shader_obj,
                        "shaderTree": shader,
                        "shaderBundle": shader_bundle,
                        "shaderPPtr": shader_pptr,
                        "uses": [],
                        "materialIdentities": set(),
                    },
                )
                expected_shader_identity = (
                    str(row["shaderObject"].assets_file.name),
                    int(row["shaderObject"].path_id),
                )
                actual_shader_identity = (str(shader_obj.assets_file.name), int(shader_obj.path_id))
                if actual_shader_identity != expected_shader_identity:
                    raise RuntimeError(f"variant {key} resolves to multiple Shader objects")
                properties = material_properties(material)
                row["materialIdentities"].add(identity)
                row["uses"].append(
                    {
                        "card": card_id,
                        "rendererPathId": str(renderer.path_id),
                        "materialSlot": slot,
                        "material": material.get("m_Name"),
                        "materialPPtr": material_pptr,
                        "materialCab": str(material_obj.assets_file.name),
                        "materialPathId": str(material_obj.path_id),
                        "properties": properties,
                    }
                )
        cards.append(
            {
                "card": card_id,
                "prefab": index.relative(path),
                "prefabSha256": index.bundle_hash(path),
                "meshRenderers": len(renderers),
                "materialReferences": material_ref_count,
            }
        )

    output_variants = []
    runtime_fragment_sources: dict[tuple[str, int], dict] = {}
    with tempfile.TemporaryDirectory(prefix="pcr-official-mrt-") as temporary_name:
        temporary = Path(temporary_name)
        for key in sorted(variants):
            row = variants[key]
            shader = row["shaderTree"]
            shader_identity = (
                str(row["shaderObject"].assets_file.name),
                int(row["shaderObject"].path_id),
            )
            runtime_source = runtime_fragment_sources.get(shader_identity)
            if runtime_source is None:
                runtime_fragment_sources[shader_identity] = {
                    "shader": row["shader"],
                    "shortShader": row["shortShader"],
                    "shaderPPtr": row["shaderPPtr"],
                    "shaderBundle": index.relative(row["shaderBundle"]),
                    "shaderBundleSha256": index.bundle_hash(row["shaderBundle"]),
                    "candidates": all_vulkan_fragment_variants(shader),
                }
            elif runtime_source["shader"] != row["shader"]:
                raise RuntimeError(f"Shader object {shader_identity} resolved conflicting names")
            selected = exact_vulkan_variant(shader, row["materialKeywords"])
            module = decompress_vulkan_program(shader, selected["blobIndex"])
            vertex = decompress_vulkan_stage(shader, selected["blobIndex"], 0)
            fragment = classify_fragment(shader, module, temporary)
            gate = fragment["zeroGateProperty"]
            gate_values = []
            if gate:
                for use in row["uses"]:
                    if gate not in use["properties"]:
                        raise RuntimeError(
                            f"Material {use['material']} omits bytecode gate property {gate}"
                        )
                    gate_values.append(use["properties"][gate])
            configured_nonzero = fragment["classification"] == "formula" and not (
                gate and all(value == 0 for value in gate_values)
            )
            material_uses = []
            for use in row["uses"]:
                evidence = {name: value for name, value in use.items() if name != "properties"}
                if gate:
                    evidence["zeroGateValue"] = use["properties"][gate]
                material_uses.append(evidence)
            output_variants.append(
                {
                    "key": row["key"],
                    "shader": row["shader"],
                    "shortShader": row["shortShader"],
                    "materialKeywords": row["materialKeywords"],
                    "compiledKeywords": selected["keywords"],
                    "keywordIndices": selected["keywordIndices"],
                    "gpuProgramType": selected["gpuProgramType"],
                    "blobIndex": selected["blobIndex"],
                    "shaderPPtr": row["shaderPPtr"],
                    "shaderBundle": index.relative(row["shaderBundle"]),
                    "shaderBundleSha256": index.bundle_hash(row["shaderBundle"]),
                    "fragmentSpvSha256": sha256_bytes(module),
                    "fragmentSpvBytes": len(module),
                    "fragmentSpecializationCount": spirv_specialization_count(module),
                    "vertexSpvSha256": sha256_bytes(vertex),
                    "vertexSpvBytes": len(vertex),
                    "vertexSpecializationCount": spirv_specialization_count(vertex),
                    "outputs": fragment["outputs"],
                    "classification": fragment["classification"],
                    "location1Assignments": fragment["assignments"],
                    "zeroGateProperty": gate,
                    "zeroGateValues": sorted(set(gate_values)),
                    "configuredNonzero": configured_nonzero,
                    "materialUseCount": len(row["uses"]),
                    "uniqueMaterialCount": len(row["materialIdentities"]),
                    "materialUses": material_uses,
                }
            )

    runtime_fragment_candidates = []
    for shader_identity in sorted(runtime_fragment_sources):
        source = runtime_fragment_sources[shader_identity]
        for candidate in source["candidates"]:
            runtime_fragment_candidates.append(
                {
                    "shader": source["shader"],
                    "shortShader": source["shortShader"],
                    "shaderPPtr": source["shaderPPtr"],
                    "shaderBundle": source["shaderBundle"],
                    "shaderBundleSha256": source["shaderBundleSha256"],
                    **candidate,
                }
            )

    shaders = []
    by_shader: dict[str, list[dict]] = {}
    for row in output_variants:
        by_shader.setdefault(row["shader"], []).append(row)
    for shader_name in sorted(by_shader):
        rows = by_shader[shader_name]
        classifications = sorted({row["classification"] for row in rows})
        if len(classifications) != 1:
            raise RuntimeError(f"shader {shader_name} variants disagree on MRT class: {classifications}")
        output_locations = sorted({item["location"] for row in rows for item in row["outputs"]})
        shaders.append(
            {
                "shader": shader_name,
                "shortShader": shader_name.split("/")[-1],
                "variantCount": len(rows),
                "outputLocations": output_locations,
                "classification": classifications[0],
                "configuredNonzero": any(row["configuredNonzero"] for row in rows),
            }
        )

    location_one = [row for row in shaders if 1 in row["outputLocations"]]
    location_zero_only = [row for row in shaders if row["outputLocations"] == [0]]
    fixed_zero = [row for row in shaders if row["classification"] == "fixed-zero"]
    formulas = [row for row in shaders if row["classification"] == "formula"]
    configured_nonzero = [row for row in shaders if row["configuredNonzero"]]
    return {
        "source": {
            "decryptedRoot": str(decrypted_root),
            "cards": list(OFFICIAL_CARDS),
            "shaderCompilerPlatform": VULKAN_PLATFORM,
            "gpuProgramType": SPIRV_PROGRAM_TYPE,
        },
        "cards": cards,
        "variants": output_variants,
        "runtimeFragmentCandidates": runtime_fragment_candidates,
        "shaders": shaders,
        "summary": {
            "meshRenderers": sum(card["meshRenderers"] for card in cards),
            "materialReferences": sum(card["materialReferences"] for card in cards),
            "rendererShaders": len(renderer_shader_names),
            "actualVariants": len(output_variants),
            "location1Shaders": len(location_one),
            "location0OnlyShaders": len(location_zero_only),
            "fixedZeroShaders": len(fixed_zero),
            "formulaShaders": len(formulas),
            "configuredNonzeroShaders": len(configured_nonzero),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    decrypted_root = args.decrypted_root.resolve()
    if not decrypted_root.is_dir():
        raise SystemExit(f"decrypted root does not exist: {decrypted_root}")
    try:
        evidence = extract(decrypted_root)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"official MRT extraction failed: {exc}") from exc
    json.dump(evidence, sys.stdout, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
