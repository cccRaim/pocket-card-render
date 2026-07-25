#!/usr/bin/env python3
"""Extract one official Vulkan program by the v4 selector proof graph.

This is deliberately stricter than ``shaderdec/dump_shader.py``: shader names,
module sizes, and first-match traversal are not selectors.  The caller supplies
the selector and candidate witness IDs recorded by the official material/program
inventory, and every object/blob/module boundary is verified before bytes are
written.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import re
import sys

import UnityPy

sys.path.insert(0, str(Path(__file__).resolve().parent / "shaderdec"))
from extract_variant_bindings import parse_parameter_blob  # noqa: E402

from extract_official_material_program_inventory import (
    DEFAULT_DECRYPTED_ROOT,
    NATIVE_VARIANT_SELECTION,
    SCHEMA,
    UNITY_VERSION,
    canonical_digest,
    decode_program_modules,
    native_best_match_vulkan_candidates,
    object_map,
    resolve_static_executable,
    sha256_bytes,
    sha256_file,
    shader_program_segments,
    static_vulkan_candidates,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INVENTORY = ROOT / "$cache" / "official-material-program-inventory-v4-full.json"
UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION


def fail(message: str) -> None:
    raise RuntimeError(message)


def one(rows: list[dict], label: str) -> dict:
    if len(rows) != 1:
        fail(f"{label} resolved to {len(rows)} rows")
    return rows[0]


def candidate_without_witness(candidate: dict) -> dict:
    value = copy.deepcopy(candidate)
    value.pop("selectorWitnessId", None)
    return value


def first_difference(actual: object, expected: object, path: str = "$") -> str:
    if type(actual) is not type(expected):
        return f"{path}: type {type(actual).__name__} != {type(expected).__name__}"
    if isinstance(actual, dict):
        if actual.keys() != expected.keys():
            return f"{path}: keys {list(actual)} != {list(expected)}"
        for key in actual:
            difference = first_difference(actual[key], expected[key], f"{path}.{key}")
            if difference:
                return difference
        return ""
    if isinstance(actual, list):
        if len(actual) != len(expected):
            return f"{path}: length {len(actual)} != {len(expected)}"
        for index, (left, right) in enumerate(zip(actual, expected)):
            difference = first_difference(left, right, f"{path}[{index}]")
            if difference:
                return difference
        return ""
    return "" if actual == expected else f"{path}: {actual!r} != {expected!r}"


def write_bytes(path: Path, data: bytes) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {
        "path": path.name,
        "byteSize": len(data),
        "sha256": sha256_bytes(data),
    }


def shader_property_defaults(shader: dict) -> dict:
    defaults = {"textures": {}, "textureDescriptors": {}, "floats": {}, "colors": {}, "vectors": {}}
    props = ((shader.get("m_ParsedForm") or {}).get("m_PropInfo") or {}).get("m_Props") or []
    for prop in props:
        name = str(prop.get("m_Name") or "")
        if not name:
            continue
        prop_type = int(prop.get("m_Type", -1))
        vector = [prop.get(f"m_DefValue[{index}]") for index in range(4)]
        if prop_type == 4:
            texture = prop.get("m_DefTexture") or {}
            texture_name = str(texture.get("m_DefaultName") or "")
            defaults["textureDescriptors"][name] = {
                "defaultName": texture_name,
                "dimension": int(texture.get("m_TexDim", -1)),
            }
            if texture_name:
                defaults["textures"][name] = texture_name
        elif prop_type == 0:
            defaults["colors"][name] = vector
        elif prop_type == 1:
            defaults["vectors"][name] = vector
        elif prop_type in (2, 3):
            defaults["floats"][name] = vector[0]
    return defaults


def close_constant_buffer_declarations(reflection: dict, serialized_buffers: dict) -> dict:
    reflected_buffers = {
        row["name"]: int(row["size"])
        for row in reflection.get("constantBuffers") or []
        if row.get("name")
    }
    variant_buffer_names = {
        str(row.get("name") or "")
        for row in reflection.get("constantBufferBindings") or []
        if row.get("name")
    }
    unknown_variant_buffers = sorted(variant_buffer_names - set(reflected_buffers))
    if unknown_variant_buffers:
        fail(f"variant constant-buffer bindings reference undeclared buffers: {unknown_variant_buffers}")
    common_size_mismatches = {
        name: {"parameter": reflected_buffers.get(name), "common": size}
        for name, size in serialized_buffers.items()
        if reflected_buffers.get(name) != size
    }
    if common_size_mismatches:
        fail(f"common constant-buffer sizes disagree with the parameter entry: {common_size_mismatches}")
    declared_buffer_names = set(serialized_buffers) | variant_buffer_names
    if set(reflected_buffers) != declared_buffer_names:
        fail(
            "parameter constant-buffer declarations are not closed by common/variant bindings: "
            + first_difference(sorted(reflected_buffers), sorted(declared_buffer_names))
        )
    if serialized_buffers and variant_buffer_names:
        mode = "mixed-common-and-variant"
    elif serialized_buffers:
        mode = "serialized-common"
    elif variant_buffer_names:
        mode = "variant-local"
    else:
        mode = "none"
    return {
        "constantBuffersMatch": True,
        "constantBufferDeclarationMode": mode,
        "commonConstantBufferCount": len(serialized_buffers),
        "variantConstantBufferCount": len(variant_buffer_names),
    }


def parameter_reflection(shader: dict, parameter_entry: bytes, common_bindings: dict) -> dict:
    props = ((shader.get("m_ParsedForm") or {}).get("m_PropInfo") or {}).get("m_Props") or []
    texture_names = {
        str(prop.get("m_Name"))
        for prop in props
        if int(prop.get("m_Type", -1)) == 4 and prop.get("m_Name")
    }
    reflection = parse_parameter_blob(parameter_entry, texture_names)
    names = {
        int(index): str(name)
        for name, index in common_bindings.get("nameIndices", [])
    }
    serialized_buffers = {}
    serialized_textures = {}
    for stage, common in (common_bindings.get("commonParameters") or {}).items():
        for item in common.get("m_ConstantBuffers") or []:
            name = names.get(int(item.get("m_NameIndex", -1)))
            if not name:
                fail(f"{stage} common constant buffer name is unresolved")
            size = int(item.get("m_Size", -1))
            previous = serialized_buffers.setdefault(name, size)
            if previous != size:
                fail(f"common constant buffer {name} size differs by stage")
        for item in common.get("m_TextureParams") or []:
            name = names.get(int(item.get("m_NameIndex", -1)))
            if not name:
                fail(f"{stage} common texture name is unresolved")
            descriptor = {
                "binding": int(item.get("m_Index", 0)) & 0xFFFFFF,
                "encodedIndex": int(item.get("m_Index", 0)),
                "dim": int(item.get("m_Dim", -1)),
            }
            previous = serialized_textures.setdefault(name, descriptor)
            if previous != descriptor:
                fail(f"common texture {name} descriptor differs by stage")

    constant_buffer_closure = close_constant_buffer_declarations(reflection, serialized_buffers)
    variant_textures = {
        row["name"]: {
            "binding": int(row["binding"]),
            "encodedIndex": int(row["encodedIndex"]),
        }
        for row in reflection.get("textures") or []
    }
    duplicate_textures = sorted(set(variant_textures) & set(serialized_textures))
    if duplicate_textures:
        fail(f"variant/common texture bindings overlap: {duplicate_textures}")
    return {
        **reflection,
        "serializedCommonBuffers": [
            {"name": name, "size": size}
            for name, size in sorted(serialized_buffers.items())
        ],
        "serializedCommonTextures": [
            {"name": name, **descriptor}
            for name, descriptor in sorted(
                serialized_textures.items(), key=lambda row: (row[1]["binding"], row[0])
            )
        ],
        "bindingClosure": {
            **constant_buffer_closure,
            "variantTextureCount": len(variant_textures),
            "commonTextureCount": len(serialized_textures),
            "constantBufferBindingCount": len(reflection.get("constantBufferBindings") or []),
        },
    }


class SelectorProgramExtractionSession:
    """Validate one inventory snapshot and extract multiple selector programs from it."""

    def __init__(
        self,
        *,
        inventory_path: Path = DEFAULT_INVENTORY,
        decrypted_root: Path = Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
        expected_proof_graph_sha256: str,
        expected_port_index_sha256: str,
        environment_loader=UnityPy.load,
    ) -> None:
        self.inventory_path = Path(inventory_path)
        self.decrypted_root = Path(decrypted_root).resolve()
        self.expected_proof_graph_sha256 = expected_proof_graph_sha256
        self.expected_port_index_sha256 = expected_port_index_sha256
        self.environment_loader = environment_loader
        self._bundle_cache: dict[Path, dict] = {}
        self._shader_cache: dict[str, dict] = {}
        self._stats = {
            "inventoryLoadCount": 0,
            "bundleLoadCount": 0,
            "objectMapBuildCount": 0,
            "shaderObjectLoadCount": 0,
            "programDecodeCount": 0,
            "extractionCount": 0,
        }
        self.inventory, self.graph, self.proof_hash, self.port_hash = self._load_inventory()

    @property
    def statistics(self) -> dict:
        return dict(self._stats)

    def _load_inventory(self) -> tuple[dict, dict, str, str]:
        self._stats["inventoryLoadCount"] += 1
        inventory = json.loads(self.inventory_path.read_text(encoding="utf-8-sig"))
        if inventory.get("schema") != SCHEMA or inventory.get("schemaVersion") != 4:
            fail(f"expected {SCHEMA}, got {inventory.get('schema')}")
        graph = inventory.get("proofGraph")
        if not isinstance(graph, dict):
            fail("selector extraction requires a --full v4 proof graph")
        digest_sources = {
            "usageRowsSha256": graph.get("usageRows") or [],
            "materialsSha256": graph.get("materials") or [],
            "shadersSha256": graph.get("shaders") or [],
            "selectorsSha256": graph.get("selectors") or [],
            "executablesSha256": graph.get("executables") or [],
            "semanticExecutablesSha256": graph.get("semanticExecutables") or [],
            "portIndexSha256": graph.get("portIndex") or [],
            "stateArchetypesSha256": graph.get("stateArchetypes") or [],
            "sourceBundlesSha256": graph.get("sourceBundles") or [],
            "exceptionalSha256": inventory.get("exceptional") or {},
        }
        stored_digests = inventory.get("digests") or {}
        verified_digests = {
            name: canonical_digest(value) for name, value in digest_sources.items()
        }
        for name, digest in verified_digests.items():
            if stored_digests.get(name) != digest:
                fail(f"inventory {name} does not describe its proof rows")
        native_digest = canonical_digest(NATIVE_VARIANT_SELECTION)
        if stored_digests.get("nativeVariantSelectionSha256") != native_digest:
            fail("inventory native variant selection digest changed")
        verified_digests["nativeVariantSelectionSha256"] = native_digest
        proof_hash = canonical_digest(verified_digests)
        port_hash = verified_digests["portIndexSha256"]
        if proof_hash != self.expected_proof_graph_sha256:
            fail(f"proof graph SHA changed: {proof_hash}")
        if port_hash != self.expected_port_index_sha256:
            fail(f"port index SHA changed: {port_hash}")
        if stored_digests.get("proofGraphSha256") != proof_hash:
            fail("inventory proofGraphSha256 does not describe its component digests")
        if canonical_digest(inventory.get("portIndex") or []) != port_hash:
            fail("compact portIndex differs from proofGraph portIndex")
        return inventory, graph, proof_hash, port_hash

    def _load_bundle(self, shader_record: dict) -> dict:
        bundle = (self.decrypted_root / shader_record["sourceBundle"]).resolve()
        try:
            bundle.relative_to(self.decrypted_root)
        except ValueError:
            fail("official source bundle escapes decrypted root")
        if not bundle.is_file():
            fail(f"official source bundle is absent: {bundle}")
        cached = self._bundle_cache.get(bundle)
        if cached is not None:
            if cached["sha256"] != shader_record["sourceBundleSha256"]:
                fail("proof graph records disagree about official source bundle SHA")
            return cached
        actual_sha256 = sha256_file(bundle)
        if actual_sha256 != shader_record["sourceBundleSha256"]:
            fail("official source bundle SHA changed")
        environment = self.environment_loader(str(bundle))
        cached = {
            "sha256": actual_sha256,
            "environment": environment,
            "objects": object_map(environment),
        }
        self._stats["bundleLoadCount"] += 1
        self._stats["objectMapBuildCount"] += 1
        self._bundle_cache[bundle] = cached
        return cached

    def _load_shader(self, selector: dict) -> dict:
        shader_identity = str(selector.get("shaderIdentity") or "")
        cached = self._shader_cache.get(shader_identity)
        if cached is not None:
            return cached
        shader_record = one([
            row for row in self.graph.get("shaders", [])
            if row.get("identity") == shader_identity
        ], "Shader identity")
        bundle = self._load_bundle(shader_record)
        cab, path_id_text = shader_record["identity"].split(":", 1)
        shader_object = bundle["objects"].get((cab, int(path_id_text)))
        if shader_object is None or shader_object.type.name != "Shader":
            actual = None if shader_object is None else shader_object.type.name
            fail(f"official Shader identity resolved to {actual}")
        raw = bytes(shader_object.get_raw_data())
        if sha256_bytes(raw) != shader_record["rawSha256"]:
            fail("official Shader object SHA changed")
        shader = shader_object.read_typetree()
        full_name = str((shader.get("m_ParsedForm") or {}).get("m_Name") or "")
        if full_name != shader_record["name"]:
            fail(f"official Shader name changed: {full_name}")
        cached = {
            "record": shader_record,
            "shader": shader,
            "segments": shader_program_segments(shader),
            "programs": {},
        }
        self._stats["shaderObjectLoadCount"] += 1
        self._shader_cache[shader_identity] = cached
        return cached

    def _decode_program(self, shader_context: dict, segment: dict, program_index: int) -> dict:
        cache_key = (int(segment["segmentIndex"]), program_index)
        cached = shader_context["programs"].get(cache_key)
        if cached is not None:
            return cached
        program_entry = segment["entries"][program_index]
        decoded = decode_program_modules(program_entry["raw"])
        records = __import__("smolv").find_and_decode_records(program_entry["raw"])
        modules_by_hash = {
            sha256_bytes(record["decoded"]): record["decoded"] for record in records
        }
        stage_bytes = {}
        for module in decoded["modules"]:
            data = modules_by_hash.get(module["sha256"])
            if data is None:
                fail(f"could not recover strict {module['stage']} module bytes")
            stage_bytes[module["stage"]] = data
        if sorted(stage_bytes) != ["fragment", "vertex"]:
            fail(f"unexpected program stages: {sorted(stage_bytes)}")
        cached = {
            "entry": program_entry,
            "stageBytes": stage_bytes,
            "programBindChannels": decoded["programBindChannels"],
        }
        shader_context["programs"][cache_key] = cached
        self._stats["programDecodeCount"] += 1
        return cached

    def extract(
        self,
        *,
        selector_id: str,
        candidate_witness_id: str,
        out: Path,
        prefix: str,
        subshader: int | None = None,
        pass_index: int | None = None,
    ) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", prefix):
            fail("prefix contains unsafe path characters")
        if (subshader is None) != (pass_index is None):
            fail("subshader and pass must either both be supplied or both be omitted")
        if subshader is not None and (type(subshader) is not int or type(pass_index) is not int):
            fail("subshader and pass must be integers")

        selector = one([
            row for row in self.graph.get("selectors", [])
            if row.get("selectorId") == selector_id
        ], "selectorId")
        candidate = one([
            row for row in selector.get("candidates", [])
            if row.get("selectorWitnessId") == candidate_witness_id
        ], "candidateWitnessId")
        if subshader is not None and (
            candidate.get("subshader") != subshader or candidate.get("pass") != pass_index
        ):
            fail("requested composite key does not match the candidate witness")
        executable_item = one([
            row for row in selector.get("staticExecutables", [])
            if row.get("candidateWitnessId") == candidate_witness_id
        ], "static executable")
        port = one([
            row for row in self.inventory.get("portIndex", [])
            if row.get("selectorId") == selector_id
            and row.get("candidateWitnessId") == candidate_witness_id
            and row.get("subshader") == candidate.get("subshader")
            and row.get("pass") == candidate.get("pass")
        ], "portIndex witness")
        shader_context = self._load_shader(selector)
        shader_record = shader_context["record"]
        shader = shader_context["shader"]

        keywords = tuple(selector.get("keywords") or [])
        selection = selector.get("candidateSelection")
        if selection == "native-best-match":
            actual_candidates, unknown = native_best_match_vulkan_candidates(shader, keywords)
        else:
            actual_candidates, unknown = static_vulkan_candidates(shader, keywords)
        if unknown:
            fail(f"official selector now has unknown keywords: {unknown}")
        expected_candidates = [
            candidate_without_witness(row) for row in selector.get("candidates", [])
        ]
        if actual_candidates != expected_candidates:
            fail("serialized Shader candidates no longer match the v4 selector proof")

        resolved = resolve_static_executable(shader, candidate)
        expected_executable = executable_item.get("executable")
        if canonical_digest(resolved) != canonical_digest(expected_executable):
            fail(
                "re-resolved executable no longer matches the v4 proof graph: "
                + first_difference(resolved, expected_executable)
            )
        if resolved.get("executableId") != port.get("executableId"):
            fail("resolved executableId no longer matches portIndex")
        if resolved.get("semanticExecutableId") != port.get("semanticExecutableId"):
            fail("resolved semanticExecutableId no longer matches portIndex")
        if resolved.get("semanticIdentityFields") != port.get("identityFields"):
            fail("resolved executable fields no longer match portIndex")

        parsed = shader.get("m_ParsedForm") or {}
        shader_pass = (parsed.get("m_SubShaders") or [])[int(candidate["subshader"])].get(
            "m_Passes"
        )[int(candidate["pass"])]
        common_bindings = {
            "nameIndices": shader_pass.get("m_NameIndices") or [],
            "commonParameters": {
                stage: (shader_pass.get(stage) or {}).get("m_CommonParameters") or {}
                for stage in (
                    "progVertex", "progFragment", "progGeometry", "progHull", "progDomain"
                )
            },
        }
        if canonical_digest(common_bindings) != resolved["semanticIdentityFields"]["commonBindingsSha256"]:
            fail("selected common bindings no longer match executable identity")

        segment = one([
            row for row in shader_context["segments"]
            if row["segmentIndex"] == resolved["segment"]["segmentIndex"]
        ], "ShaderProgram segment")
        entries = segment["entries"]
        program_index = int(candidate["programBlobIndex"])
        parameter_index = int(candidate["parameterBlobIndex"])
        if min(program_index, parameter_index) < 0 or max(program_index, parameter_index) >= len(entries):
            fail("selector blob index is outside the ShaderProgram table")
        parameter_entry = entries[parameter_index]
        parsed_parameter = parameter_reflection(shader, parameter_entry["raw"], common_bindings)
        program = self._decode_program(shader_context, segment, program_index)
        stage_bytes = program["stageBytes"]

        fields = resolved["semanticIdentityFields"]
        if sha256_bytes(stage_bytes["vertex"]) != fields["vertexSpirvSha256"]:
            fail("recovered vertex SPIR-V SHA changed")
        if sha256_bytes(stage_bytes["fragment"]) != fields["fragmentSpirvSha256"]:
            fail("recovered fragment SPIR-V SHA changed")
        if sha256_bytes(parameter_entry["raw"]) != fields["parameterEntrySha256"]:
            fail("recovered parameter entry SHA changed")

        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        artifacts = {
            "vertex": write_bytes(out / f"{prefix}_vert.spv", stage_bytes["vertex"]),
            "fragment": write_bytes(out / f"{prefix}_frag.spv", stage_bytes["fragment"]),
            "parameterEntry": write_bytes(
                out / f"{prefix}_parameter.bin", parameter_entry["raw"]
            ),
        }
        if artifacts["vertex"]["sha256"] != fields["vertexSpirvSha256"]:
            fail("written vertex SPIR-V SHA changed")
        if artifacts["fragment"]["sha256"] != fields["fragmentSpirvSha256"]:
            fail("written fragment SPIR-V SHA changed")
        if artifacts["parameterEntry"]["sha256"] != fields["parameterEntrySha256"]:
            fail("written parameter entry SHA changed")

        metadata = {
            "schema": "pocket-card-render/official-selector-program-extract@1",
            "unityVersion": UNITY_VERSION,
            "inventory": {
                "schema": SCHEMA,
                "proofGraphSha256": self.proof_hash,
                "portIndexSha256": self.port_hash,
            },
            "selector": {
                "selectorId": selector_id,
                "candidateWitnessId": candidate_witness_id,
                "shaderIdentity": selector["shaderIdentity"],
                "shaderName": shader_record["name"],
                "keywords": list(keywords),
                "selectionMode": selector["selectionMode"],
                "subshader": candidate["subshader"],
                "pass": candidate["pass"],
                "programBlobIndex": program_index,
                "parameterBlobIndex": parameter_index,
                "executableId": resolved["executableId"],
                "semanticExecutableId": resolved["semanticExecutableId"],
            },
            "source": {
                "bundle": shader_record["sourceBundle"],
                "bundleSha256": shader_record["sourceBundleSha256"],
                "shaderObjectSha256": shader_record["rawSha256"],
                "programEntrySha256": resolved["programEntry"]["sha256"],
            },
            "identityFields": fields,
            "passContract": resolved["pass"]["contract"],
            "commonBindings": common_bindings,
            "programBindChannels": program["programBindChannels"],
            "parameterReflection": parsed_parameter,
            "parameterReflectionSha256": canonical_digest(parsed_parameter),
            "shaderPropertyDefaults": shader_property_defaults(shader),
            "artifacts": artifacts,
        }
        self._stats["extractionCount"] += 1
        return metadata


def encode_metadata(metadata: dict) -> str:
    return json.dumps(metadata, ensure_ascii=True, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selector-id", required=True)
    parser.add_argument("--candidate-witness-id", required=True)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--expected-proof-graph-sha256", required=True)
    parser.add_argument("--expected-port-index-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()

    session = SelectorProgramExtractionSession(
        inventory_path=args.inventory,
        decrypted_root=args.decrypted_root,
        expected_proof_graph_sha256=args.expected_proof_graph_sha256,
        expected_port_index_sha256=args.expected_port_index_sha256,
    )
    metadata = session.extract(
        selector_id=args.selector_id,
        candidate_witness_id=args.candidate_witness_id,
        out=args.out,
        prefix=args.prefix,
    )
    encoded = encode_metadata(metadata)
    if args.metadata:
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(encoded, encoding="ascii")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BAD official selector program extract: {error}", file=sys.stderr)
        raise SystemExit(1)
