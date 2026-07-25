#!/usr/bin/env python3
"""Extract SRP Batcher evidence for the four canonical card scenes.

The scenes contribute only official draw identities. Material and Shader data
is decoded again from the official bundles, including Material.m_Shader PPtrs
and Vulkan Shader parameter reflection. Material or Shader names are never
used to classify compatibility.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import warnings

try:
    import lz4.block
    import UnityPy
except ImportError as exc:  # pragma: no cover - host setup failure
    raise SystemExit("UnityPy and lz4 are required") from exc

from shaderdec.unity_parameter_entry import parse_parameter_entry as parse_unity_parameter_entry


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
UNITY_VERSION = "2022.3.62f2"
SCHEMA = "pocket-card-render/official-srp-batcher@1"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
STAGES = (
    "progVertex",
    "progFragment",
    "progGeometry",
    "progHull",
    "progDomain",
)
CANONICAL_CARDS = (
    "cPK_10_000040_00_FUSHIGIBANAex_RR",
    "cPK_20_008900_02_HOUOUex_UR",
    "cTR_20_000230_00_LEAF_SR",
    "cTR_20_000670_00_IIBUINOBAKKU_UR",
)
IDENTITY_RE = re.compile(r"^(CAB-[0-9a-f]{32}):(-?[0-9]+)$")
CAB_BYTES_RE = re.compile(rb"CAB-[0-9a-f]{32}")
CBUFFER_RE = re.compile(r"^(?:[PV]Globals[0-9]+|UnityPerDraw)$")

UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return sha256_bytes(encoded)


def parse_identity(value: object, label: str) -> tuple[str, int, str]:
    if not isinstance(value, str):
        raise RuntimeError(f"{label} must be a CAB:pathID string")
    match = IDENTITY_RE.fullmatch(value)
    if match is None:
        raise RuntimeError(f"{label} has invalid identity {value!r}")
    cab = match.group(1)
    path_id = int(match.group(2))
    return cab, path_id, f"{cab}:{path_id}"


class OfficialBundleIndex:
    def __init__(self, decrypted_root: Path):
        self.decrypted_root = decrypted_root.resolve()
        self.loaded: dict[Path, tuple[object, dict[tuple[str, int], object]]] = {}
        self.cab_paths: dict[str, Path] = {}
        self.hashes: dict[Path, str] = {}
        self.scanned = 0

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.decrypted_root).as_posix()

    def load(self, path: Path) -> tuple[object, dict[tuple[str, int], object]]:
        path = path.resolve()
        if path not in self.loaded:
            environment = UnityPy.load(str(path))
            objects = {
                (str(obj.assets_file.name), int(obj.path_id)): obj
                for obj in environment.objects
            }
            if not objects:
                raise RuntimeError(f"bundle has no serialized objects: {path}")
            self.loaded[path] = (environment, objects)
        return self.loaded[path]

    def locate(self, target_cabs: set[str], candidates: list[Path], role: str) -> None:
        unresolved = set(target_cabs) - set(self.cab_paths)
        seen: set[Path] = set()
        for candidate in candidates:
            path = candidate.resolve()
            if path in seen:
                continue
            seen.add(path)
            if not path.is_file():
                raise RuntimeError(f"missing official {role} bundle: {path}")
            self.scanned += 1
            mentions = {
                match.group(0).decode("ascii")
                for match in CAB_BYTES_RE.finditer(path.read_bytes())
            }
            if not (mentions & unresolved):
                continue
            _, objects = self.load(path)
            owned = {cab for cab, _ in objects}
            for cab in sorted(owned & unresolved):
                previous = self.cab_paths.get(cab)
                if previous is not None and previous != path:
                    raise RuntimeError(f"duplicate CAB {cab}: {previous} and {path}")
                self.cab_paths[cab] = path
                unresolved.remove(cab)
            if not unresolved:
                break
        if unresolved:
            raise RuntimeError(
                f"could not locate {role} CABs: {', '.join(sorted(unresolved))}"
            )

    def object(self, identity: str, expected_type: str) -> tuple[object, Path]:
        cab, path_id, canonical = parse_identity(identity, expected_type)
        bundle = self.cab_paths.get(cab)
        if bundle is None:
            raise RuntimeError(f"CAB was not indexed for {canonical}")
        obj = self.load(bundle)[1].get((cab, path_id))
        if obj is None:
            raise RuntimeError(f"object is absent from official CAB: {canonical}")
        if obj.type.name != expected_type:
            raise RuntimeError(
                f"official object {canonical} is {obj.type.name}, expected {expected_type}"
            )
        return obj, bundle

    def bundle_sha256(self, path: Path) -> str:
        path = path.resolve()
        if path not in self.hashes:
            self.hashes[path] = sha256_file(path)
        return self.hashes[path]


def read_draw_targets() -> tuple[list[dict], list[dict]]:
    scenes = []
    rows = []
    seen_draw_ids: set[str] = set()
    for card_id in CANONICAL_CARDS:
        scene_file = f"scene.{card_id}.json"
        scene_path = ROOT / "public" / scene_file
        scene = json.loads(scene_path.read_text(encoding="utf-8-sig"))
        if (scene.get("card") or {}).get("id") != card_id:
            raise RuntimeError(f"{scene_file}: canonical card identity mismatch")
        if scene.get("officialDrawSchemaVersion") != 2:
            raise RuntimeError(f"{scene_file}: unsupported official draw schema")
        draws = scene.get("officialDraws")
        if not isinstance(draws, list):
            raise RuntimeError(f"{scene_file}: officialDraws is not an array")
        card_rows = []
        for draw_index, draw in enumerate(draws):
            label = f"{scene_file}:officialDraws[{draw_index}]"
            if not isinstance(draw, dict):
                raise RuntimeError(f"{label} is not an object")
            draw_id = draw.get("drawId")
            go_path = draw.get("goPath")
            if not isinstance(go_path, str) or not go_path:
                raise RuntimeError(f"{label}.goPath is invalid")
            renderer = parse_identity(draw.get("rendererIdentity"), f"{label}.renderer")[2]
            material = parse_identity(draw.get("materialIdentity"), f"{label}.material")[2]
            shader = parse_identity(draw.get("shaderIdentity"), f"{label}.shader")[2]
            material_slot = draw.get("materialSlot")
            if not isinstance(material_slot, int) or material_slot < 0:
                raise RuntimeError(f"{label}.materialSlot is invalid")
            if draw_id != f"{renderer}#{material_slot}":
                raise RuntimeError(f"{label}.drawId is not renderer identity plus slot")
            if draw_id in seen_draw_ids:
                raise RuntimeError(f"duplicate official draw identity {draw_id}")
            seen_draw_ids.add(draw_id)
            row = {
                "sceneFile": scene_file,
                "cardId": card_id,
                "drawIndex": draw_index,
                "drawId": draw_id,
                "goPath": go_path,
                "rendererIdentity": renderer,
                "materialSlot": material_slot,
                "materialIdentity": material,
                "sceneShaderIdentity": shader,
            }
            rows.append(row)
            card_rows.append(row)
        scenes.append(
            {
                "sceneFile": scene_file,
                "cardId": card_id,
                "drawCount": len(card_rows),
                "uniqueMaterials": len({row["materialIdentity"] for row in card_rows}),
                "uniqueShaders": len({row["sceneShaderIdentity"] for row in card_rows}),
                "drawsSha256": canonical_digest(card_rows),
            }
        )
    return scenes, rows


def pptr_record(owner: object, pointer: object, label: str) -> dict:
    if not isinstance(pointer, dict):
        raise RuntimeError(f"{label} is not a serialized PPtr")
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if path_id == 0:
        raise RuntimeError(f"{label} is null")
    source_cab = str(owner.assets_file.name)
    if file_id == 0:
        target_cab = source_cab
    else:
        externals = owner.assets_file.externals
        if file_id < 1 or file_id > len(externals):
            raise RuntimeError(f"{label} file ID is outside the external table")
        target_cab = str(externals[file_id - 1].name)
        if not re.fullmatch(r"CAB-[0-9a-f]{32}", target_cab):
            raise RuntimeError(f"{label} external is not an official CAB")
    return {
        "sourceCab": source_cab,
        "fileId": file_id,
        "pathId": str(path_id),
        "targetCab": target_cab,
        "identity": f"{target_cab}:{path_id}",
    }


def material_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = index.object(identity, "Material")
    tree = obj.read_typetree()
    if "m_Shader" not in tree:
        raise RuntimeError(f"Material {identity} has no m_Shader field")
    raw = bytes(obj.get_raw_data())
    pointer = pptr_record(obj, tree["m_Shader"], f"Material {identity}.m_Shader")
    return {
        "identity": identity,
        "sourceBundle": index.relative(bundle),
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "shaderPointer": pointer,
        "shaderIdentity": pointer["identity"],
    }


def u32(data: bytes, offset: int) -> tuple[int, int]:
    if offset + 4 > len(data):
        raise RuntimeError("reflection u32 exceeds parameter entry")
    return struct.unpack_from("<I", data, offset)[0], offset + 4


def aligned_string(data: bytes, offset: int) -> tuple[str, int]:
    length, offset = u32(data, offset)
    end = offset + length
    if end > len(data):
        raise RuntimeError("reflection string exceeds parameter entry")
    try:
        value = data[offset:end].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("reflection string is not UTF-8") from exc
    return value, (end + 3) & ~3


def parse_parameter_entry(data: bytes) -> dict:
    try:
        return parse_unity_parameter_entry(data, parse_resources=False)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc


def nested_row(value: object, index: int) -> list:
    row = value[index]
    return list(row) if isinstance(row, (list, tuple)) else [row]


def shader_program_tables(shader: dict) -> list[list[bytes]]:
    platforms = [int(value) for value in shader.get("platforms", [])]
    if platforms != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected Shader platforms {platforms}")
    blob = bytes(shader.get("compressedBlob", []))
    offsets = nested_row(shader.get("offsets", []), 0)
    lengths = nested_row(shader.get("compressedLengths", []), 0)
    decoded_lengths = nested_row(shader.get("decompressedLengths", []), 0)
    if not (len(offsets) == len(lengths) == len(decoded_lengths)):
        raise RuntimeError("Shader compressed program arrays disagree")
    tables = []
    for raw_offset, raw_length, raw_decoded_length in zip(
        offsets, lengths, decoded_lengths
    ):
        start = int(raw_offset)
        length = int(raw_length)
        decoded = lz4.block.decompress(
            blob[start : start + length], uncompressed_size=int(raw_decoded_length)
        )
        count, _ = u32(decoded, 0)
        table_end = 4 + count * 12
        if table_end > len(decoded):
            raise RuntimeError("ShaderProgram table is truncated")
        entries = []
        for entry_index in range(count):
            entry_offset, entry_length, _ = struct.unpack_from(
                "<III", decoded, 4 + entry_index * 12
            )
            if entry_offset + entry_length > len(decoded):
                raise RuntimeError("ShaderProgram entry exceeds decompressed bytes")
            entries.append(decoded[entry_offset : entry_offset + entry_length])
        tables.append(entries)
    return tables


def reflection_references(parsed: dict) -> list[dict]:
    references = []
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders") or []):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes") or []):
            for stage_name in STAGES:
                stage = shader_pass.get(stage_name) or {}
                groups = stage.get("m_PlayerSubPrograms") or []
                parameter_groups = stage.get("m_ParameterBlobIndices") or []
                for group_index, players in enumerate(groups):
                    parameters = (
                        parameter_groups[group_index]
                        if group_index < len(parameter_groups)
                        else []
                    )
                    for variant_index, player in enumerate(players or []):
                        if int(player.get("m_GpuProgramType", -1)) != SPIRV_PROGRAM_TYPE:
                            continue
                        if variant_index >= len(parameters):
                            raise RuntimeError("Vulkan program has no parameter blob index")
                        references.append(
                            {
                                "subshaderIndex": subshader_index,
                                "passIndex": pass_index,
                                "stage": stage_name,
                                "groupIndex": group_index,
                                "variantIndex": variant_index,
                                "parameterBlobIndex": int(parameters[variant_index]),
                                "programBlobIndex": int(player.get("m_BlobIndex", -1)),
                                "keywordIndices": [
                                    int(value)
                                    for value in player.get("m_KeywordIndices", [])
                                ],
                            }
                        )
    if not references:
        raise RuntimeError("Shader has no Vulkan reflection references")
    return references


def reflected_entries(shader: dict, references: list[dict]) -> list[dict]:
    tables = shader_program_tables(shader)
    counts = {}
    for reference in references:
        index = reference["parameterBlobIndex"]
        counts[index] = counts.get(index, 0) + 1
    output = []
    for parameter_index in sorted(counts):
        candidates = []
        for table in tables:
            if parameter_index >= len(table):
                continue
            raw = table[parameter_index]
            try:
                parsed = parse_parameter_entry(raw)
            except RuntimeError:
                continue
            if parsed["constantBuffers"]:
                candidates.append((raw, parsed))
        unique = {sha256_bytes(raw): (raw, parsed) for raw, parsed in candidates}
        if not unique:
            continue
        if len(unique) != 1:
            raise RuntimeError(
                f"parameter blob {parameter_index} has {len(unique)} reflected candidates"
            )
        raw, parsed = next(iter(unique.values()))
        output.append(
            {
                "parameterBlobIndex": parameter_index,
                "referenceCount": counts[parameter_index],
                "rawByteSize": len(raw),
                "rawSha256": sha256_bytes(raw),
                **parsed,
            }
        )
    return output


def serialized_reflections(parsed: dict) -> list[dict]:
    output = []
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders") or []):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes") or []):
            names = {
                int(index): str(name)
                for name, index in shader_pass.get("m_NameIndices") or []
            }
            for stage_name in STAGES:
                common = (shader_pass.get(stage_name) or {}).get("m_CommonParameters") or {}
                for buffer in common.get("m_ConstantBuffers") or []:
                    buffer_name = names.get(int(buffer.get("m_NameIndex", -1)))
                    if not buffer_name:
                        raise RuntimeError("serialized CBuffer name index is unresolved")
                    fields = []
                    for field in buffer.get("m_MatrixParams") or []:
                        fields.append(
                            {
                                "name": names.get(int(field.get("m_NameIndex", -1))),
                                "kind": "matrix",
                                "offset": int(field.get("m_Index", -1)),
                                "arraySize": int(field.get("m_ArraySize", 0)),
                                "scalarType": int(field.get("m_Type", -1)),
                                "dimension": int(field.get("m_RowCount", 0)),
                            }
                        )
                    for field in buffer.get("m_VectorParams") or []:
                        fields.append(
                            {
                                "name": names.get(int(field.get("m_NameIndex", -1))),
                                "kind": "vector",
                                "offset": int(field.get("m_Index", -1)),
                                "arraySize": int(field.get("m_ArraySize", 0)),
                                "scalarType": int(field.get("m_Type", -1)),
                                "dimension": int(field.get("m_Dim", 0)),
                            }
                        )
                    if any(field["name"] is None for field in fields):
                        raise RuntimeError("serialized CBuffer field name index is unresolved")
                    output.append(
                        {
                            "subshaderIndex": subshader_index,
                            "passIndex": pass_index,
                            "stage": stage_name,
                            "buffer": buffer_name,
                            "bufferSize": int(buffer.get("m_Size", -1)),
                            "partial": bool(buffer.get("m_IsPartialCB", False)),
                            "fields": sorted(
                                fields,
                                key=lambda row: (row["offset"], row["kind"], row["name"]),
                            ),
                        }
                    )
    return output


def witness_rows(entries: list[dict], serialized: list[dict]) -> list[dict]:
    witnesses = []
    for entry in entries:
        for buffer in entry["constantBuffers"]:
            if buffer["name"] == "UnityPerDraw":
                continue
            if not buffer["name"].startswith(("VGlobals", "PGlobals")):
                continue
            for field in buffer["fields"]:
                if field["name"] != "unity_ObjectToWorld":
                    continue
                witnesses.append(
                    {
                        "source": "parameter-blob",
                        "parameterBlobIndex": entry["parameterBlobIndex"],
                        "parameterBlobSha256": entry["rawSha256"],
                        "buffer": buffer["name"],
                        "bufferSize": buffer["size"],
                        "field": field["name"],
                        "offset": field["offset"],
                        "descriptor": field["descriptor"],
                    }
                )
    for buffer in serialized:
        if buffer["buffer"] == "UnityPerDraw":
            continue
        if not buffer["buffer"].startswith(("VGlobals", "PGlobals")):
            continue
        for field in buffer["fields"]:
            if field["name"] != "unity_ObjectToWorld":
                continue
            witnesses.append(
                {
                    "source": "serialized-common-parameters",
                    "subshaderIndex": buffer["subshaderIndex"],
                    "passIndex": buffer["passIndex"],
                    "stage": buffer["stage"],
                    "buffer": buffer["buffer"],
                    "bufferSize": buffer["bufferSize"],
                    "field": field["name"],
                    "offset": field["offset"],
                    "descriptor": {
                        "kind": field["kind"],
                        "arraySize": field["arraySize"],
                        "scalarType": field["scalarType"],
                        "dimension": field["dimension"],
                    },
                }
            )
    return sorted(
        witnesses,
        key=lambda row: (
            row["source"],
            row.get("parameterBlobIndex", -1),
            row["buffer"],
            row["offset"],
            str(row["descriptor"]),
        ),
    )


def shader_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = index.object(identity, "Shader")
    tree = obj.read_typetree()
    parsed = tree.get("m_ParsedForm")
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Shader {identity} has no parsed form")
    subshaders = parsed.get("m_SubShaders") or []
    references = reflection_references(parsed)
    reflections = reflected_entries(tree, references)
    serialized = serialized_reflections(parsed)
    witnesses = witness_rows(reflections, serialized)
    raw = bytes(obj.get_raw_data())
    return {
        "identity": identity,
        "sourceBundle": index.relative(bundle),
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "platforms": [int(value) for value in tree.get("platforms", [])],
        "subshaderCount": len(subshaders),
        "passCount": sum(len(subshader.get("m_Passes") or []) for subshader in subshaders),
        "vulkanReferenceCount": len(references),
        "vulkanReferences": references,
        "parameterReflections": reflections,
        "serializedReflections": serialized,
        "nonUnityPerDrawObjectToWorldWitnesses": witnesses,
    }


def source_bundle_records(
    index: OfficialBundleIndex, material_cabs: set[str], shader_cabs: set[str]
) -> list[dict]:
    records = []
    for cab in sorted(material_cabs | shader_cabs):
        path = index.cab_paths[cab]
        roles = []
        if cab in material_cabs:
            roles.append("Material")
        if cab in shader_cabs:
            roles.append("Shader")
        records.append(
            {
                "cab": cab,
                "roles": roles,
                "relativePath": index.relative(path),
                "byteSize": path.stat().st_size,
                "sha256": index.bundle_sha256(path),
            }
        )
    return records


def extract(decrypted_root: Path) -> dict:
    decrypted_root = decrypted_root.resolve()
    if not decrypted_root.is_dir():
        raise RuntimeError(f"decrypted root does not exist: {decrypted_root}")
    scenes, draws = read_draw_targets()
    material_identities = sorted({row["materialIdentity"] for row in draws})
    material_cabs = {
        parse_identity(identity, "Material")[0] for identity in material_identities
    }

    common_root = decrypted_root / "Common" / "CardNew" / "Common"
    shader_root = decrypted_root / "Common" / "Shader"
    common_bundles = sorted(common_root.rglob("*_bundles"), key=lambda p: p.as_posix())
    face_bundles = [
        decrypted_root
        / "Common"
        / "CardNew"
        / "Face"
        / card_id
        / "L"
        / "Prefabs"
        / f"{card_id}_L.prefab_bundles"
        for card_id in CANONICAL_CARDS
    ]
    shader_bundles = sorted(shader_root.rglob("*_bundles"), key=lambda p: p.as_posix())
    if not common_bundles or not shader_bundles:
        raise RuntimeError("official Material or Shader bundle roots are empty")

    index = OfficialBundleIndex(decrypted_root)
    index.locate(material_cabs, common_bundles + face_bundles, "Material")
    materials = [material_record(index, identity) for identity in material_identities]
    material_by_identity = {row["identity"]: row for row in materials}
    shader_identities = sorted({row["shaderIdentity"] for row in materials})
    shader_cabs = {
        parse_identity(identity, "Shader")[0] for identity in shader_identities
    }
    index.locate(shader_cabs, shader_bundles, "Material.m_Shader")
    shaders = [shader_record(index, identity) for identity in shader_identities]

    verified_draws = []
    for draw in draws:
        actual_shader = material_by_identity[draw["materialIdentity"]]["shaderIdentity"]
        if actual_shader != draw["sceneShaderIdentity"]:
            raise RuntimeError(
                f"{draw['drawId']}: scene Shader identity disagrees with Material.m_Shader"
            )
        verified_draws.append({**draw, "shaderIdentity": actual_shader})

    source_bundles = source_bundle_records(index, material_cabs, shader_cabs)
    digests = {
        "canonicalDrawsSha256": canonical_digest(verified_draws),
        "sourceBundlesSha256": canonical_digest(source_bundles),
        "materialShaderPPtrsSha256": canonical_digest(materials),
        "shaderReflectionsSha256": canonical_digest(shaders),
    }
    digests["evidenceSha256"] = canonical_digest(
        {
            "draws": verified_draws,
            "sourceBundles": source_bundles,
            "materials": materials,
            "shaders": shaders,
        }
    )
    return {
        "schema": SCHEMA,
        "schemaVersion": 1,
        "unityVersion": UNITY_VERSION,
        "canonicalScenes": scenes,
        "locator": {
            "materialBundleFiles": len(common_bundles) + len(face_bundles),
            "shaderBundleFiles": len(shader_bundles),
            "scannedBundleFiles": index.scanned,
            "loadedBundleFiles": len(index.loaded),
        },
        "summary": {
            "cards": len(scenes),
            "draws": len(verified_draws),
            "uniqueMaterials": len(materials),
            "uniqueShaders": len(shaders),
            "sourceBundles": len(source_bundles),
            "singleSubshaderShaders": sum(
                row["subshaderCount"] == 1 for row in shaders
            ),
            "witnessShaders": sum(
                bool(row["nonUnityPerDrawObjectToWorldWitnesses"])
                for row in shaders
            ),
        },
        "draws": verified_draws,
        "sourceBundles": source_bundles,
        "materials": materials,
        "shaders": shaders,
        "digests": digests,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    output = extract(args.decrypted_root)
    print(
        json.dumps(
            output,
            ensure_ascii=True,
            indent=2 if args.pretty else None,
            separators=None if args.pretty else (",", ":"),
        )
    )


if __name__ == "__main__":
    main()
