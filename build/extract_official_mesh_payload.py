#!/usr/bin/env python3
"""Compare official Unity Mesh payloads with the canonical AssetRipper GLBs.

The comparison expands both sides to ordered triangle streams, so exporter
vertex remapping and per-submesh duplication do not weaken the result.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import warnings

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
CARDS = (
    "cPK_10_000040_00_FUSHIGIBANAex_RR",
    "cTR_20_000230_00_LEAF_SR",
    "cTR_20_000670_00_IIBUINOBAKKU_UR",
    "cPK_20_008900_02_HOUOUex_UR",
)
GLB_COMPONENTS = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
GLB_DIMENSIONS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
SEMANTICS = {
    "POSITION": ("m_Vertices", 3),
    "NORMAL": ("m_Normals", 3),
    "TANGENT": ("m_Tangents", 4),
    "COLOR_0": ("m_Colors", 4),
    "TEXCOORD_0": ("m_UV0", 2),
    "TEXCOORD_1": ("m_UV1", 2),
    "TEXCOORD_2": ("m_UV2", 2),
    "TEXCOORD_3": ("m_UV3", 2),
    "TEXCOORD_4": ("m_UV4", 2),
    "TEXCOORD_5": ("m_UV5", 2),
    "TEXCOORD_6": ("m_UV6", 2),
    "TEXCOORD_7": ("m_UV7", 2),
}

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def load_module(name: str, source: Path):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load helper {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MRT = load_module(
    "pcr_mesh_payload_mrt", ROOT / "build" / "extract_official_mrt_outputs.py"
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", float(value)))[0]


def canonical_components(semantic: str, value: tuple) -> tuple[float, ...]:
    if semantic == "POSITION" or semantic == "NORMAL":
        return (f32(-value[0]), f32(value[1]), f32(value[2]))
    if semantic == "TANGENT":
        return (f32(-value[0]), f32(value[1]), f32(value[2]), f32(-value[3]))
    if semantic == "COLOR_0":
        return tuple(f32(component) for component in value)
    if semantic.startswith("TEXCOORD_"):
        return (f32(value[0]), f32(1.0 - f32(value[1])))
    raise RuntimeError(f"unsupported semantic {semantic}")


def packed_floats(values: list[tuple[float, ...]]) -> bytes:
    return b"".join(struct.pack(f"<{len(value)}f", *value) for value in values)


class Glb:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.data = self.path.read_bytes()
        if self.data[:4] != b"glTF" or struct.unpack_from("<I", self.data, 4)[0] != 2:
            raise RuntimeError(f"{path}: expected GLB v2")
        if struct.unpack_from("<I", self.data, 8)[0] != len(self.data):
            raise RuntimeError(f"{path}: declared length mismatch")
        offset = 12
        self.json = None
        self.bin = None
        self.bin_file_offset = None
        while offset + 8 <= len(self.data):
            size, kind = struct.unpack_from("<II", self.data, offset)
            offset += 8
            payload = self.data[offset:offset + size]
            offset += size
            if kind == 0x4E4F534A:
                self.json = json.loads(payload.rstrip(b"\x00 \t\r\n"))
            elif kind == 0x004E4942:
                self.bin = bytearray(payload)
                self.bin_file_offset = offset - size
        if self.json is None or self.bin is None:
            raise RuntimeError(f"{path}: JSON or BIN chunk missing")
        if len(self.json.get("buffers", [])) != 1:
            raise RuntimeError(f"{path}: expected one embedded buffer")
        self.nodes_by_path = self._nodes_by_path()

    def _nodes_by_path(self) -> dict[str, list[dict]]:
        nodes = self.json.get("nodes", [])
        result = {}

        def visit(index: int, parent: str) -> None:
            node = nodes[index]
            name = str(node.get("name", index))
            node_path = f"{parent}/{name}" if parent else name
            node["_pcrNodeIndex"] = index
            result.setdefault(node_path, []).append(node)
            for child in node.get("children", []):
                visit(int(child), node_path)

        scene_index = int(self.json.get("scene", 0))
        for root in self.json.get("scenes", [])[scene_index].get("nodes", []):
            visit(int(root), "")
        return result

    def accessor(self, index: int) -> list[tuple]:
        accessor = self.json["accessors"][index]
        if "sparse" in accessor:
            raise RuntimeError(f"{self.path}: sparse accessor {index} is unsupported")
        view = self.json["bufferViews"][accessor["bufferView"]]
        if int(view.get("buffer", 0)) != 0:
            raise RuntimeError(f"{self.path}: external accessor buffer")
        component_type = int(accessor["componentType"])
        code, size = GLB_COMPONENTS[component_type]
        dimension = GLB_DIMENSIONS[accessor["type"]]
        stride = int(view.get("byteStride", size * dimension))
        start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
        fmt = f"<{dimension}{code}"
        values = [
            struct.unpack_from(fmt, self.bin, start + vertex * stride)
            for vertex in range(int(accessor["count"]))
        ]
        if accessor.get("normalized") and component_type != 5126:
            signed = component_type in (5120, 5122)
            bits = size * 8
            scale = (1 << (bits - 1)) - 1 if signed else (1 << bits) - 1
            values = [tuple(max(float(item) / scale, -1.0) for item in value) for value in values]
        return values

    def mesh_candidates(self, node_path: str) -> list[dict]:
        nodes = self.nodes_by_path.get(node_path)
        if not nodes:
            raise RuntimeError(f"{self.path}: official node absent from GLB: {node_path}")
        return [node for node in nodes if "mesh" in node]

    def node_primitives(self, node: dict) -> list[dict]:
        return list(self.json["meshes"][int(node["mesh"])].get("primitives", []))

    def material_name(self, primitive: dict) -> str:
        index = primitive.get("material")
        if index is None:
            return ""
        return str(self.json.get("materials", [])[int(index)].get("name", ""))

    def write_accessor(self, index: int, values: list[tuple[float, ...]]) -> None:
        accessor = self.json["accessors"][index]
        if int(accessor["componentType"]) != 5126 or accessor.get("normalized"):
            raise RuntimeError(f"{self.path}: accessor {index} is not raw FLOAT32")
        if len(values) != int(accessor["count"]):
            raise RuntimeError(f"{self.path}: accessor {index} value count mismatch")
        view = self.json["bufferViews"][accessor["bufferView"]]
        dimension = GLB_DIMENSIONS[accessor["type"]]
        stride = int(view.get("byteStride", 4 * dimension))
        start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
        for vertex, value in enumerate(values):
            if len(value) != dimension:
                raise RuntimeError(f"{self.path}: accessor {index} dimension mismatch")
            struct.pack_into(f"<{dimension}f", self.bin, start + vertex * stride, *value)

    def save(self) -> None:
        if self.bin_file_offset is None:
            raise RuntimeError(f"{self.path}: BIN chunk offset missing")
        output = bytearray(self.data)
        output[self.bin_file_offset:self.bin_file_offset + len(self.bin)] = self.bin
        self.path.write_bytes(output)
        self.data = bytes(output)


def pointer_path_id(pointer: object) -> int:
    if not isinstance(pointer, dict):
        return 0
    return int(pointer.get("m_PathID", 0))


def local_object(objects: dict, owner: object, pointer: object) -> object:
    path_id = pointer_path_id(pointer)
    key = (str(owner.assets_file.name), path_id)
    target = objects.get(key)
    if target is None:
        raise RuntimeError(f"local PPtr missing: {key[0]}:{path_id}")
    return target


def canonical_object_identity(obj: object) -> str:
    return f"{obj.assets_file.name}:{int(obj.path_id)}"


def pointer_identity(owner: object, pointer: object) -> str:
    if not isinstance(pointer, dict):
        raise RuntimeError("expected serialized PPtr")
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if path_id == 0:
        raise RuntimeError("material PPtr is null")
    if file_id == 0:
        cab = str(owner.assets_file.name)
    else:
        externals = owner.assets_file.externals
        if file_id < 1 or file_id > len(externals):
            raise RuntimeError(f"material PPtr file ID {file_id} is outside external table")
        cab = str(externals[file_id - 1].name)
    return f"{cab}:{path_id}"


def game_object_key(component: object, objects: dict) -> tuple[str, int]:
    game_object = local_object(
        objects, component, component.read_typetree().get("m_GameObject")
    )
    return str(game_object.assets_file.name), int(game_object.path_id)


def game_object_path_and_transform(mesh_filter: object, objects: dict) -> tuple[str, dict]:
    game_object = local_object(
        objects, mesh_filter, mesh_filter.read_typetree().get("m_GameObject")
    )
    parts = []
    mesh_transform_tree = None
    while game_object is not None:
        game_tree = game_object.read_typetree()
        parts.append(str(game_tree.get("m_Name", "")))
        transforms = []
        for component in game_tree.get("m_Component", []) or []:
            candidate = local_object(objects, game_object, component.get("component", component))
            if candidate.type.name == "Transform":
                transforms.append(candidate)
        if len(transforms) != 1:
            raise RuntimeError(f"GameObject {game_object.path_id} has {len(transforms)} Transforms")
        if mesh_transform_tree is None:
            mesh_transform_tree = transforms[0].read_typetree()
        father = transforms[0].read_typetree().get("m_Father") or {}
        if pointer_path_id(father) == 0:
            break
        parent_transform = local_object(objects, transforms[0], father)
        game_object = local_object(
            objects, parent_transform, parent_transform.read_typetree().get("m_GameObject")
        )
    if mesh_transform_tree is None:
        raise RuntimeError(f"MeshFilter {mesh_filter.path_id} has no Transform")
    return "/".join(reversed(parts)), mesh_transform_tree


def transform_tuple(tree: dict, key: str, names: tuple[str, ...], defaults: tuple[float, ...]) -> tuple[float, ...]:
    value = tree.get(key) or {}
    return tuple(f32(value.get(name, default)) for name, default in zip(names, defaults))


def glb_transform_tuple(node: dict, key: str, defaults: tuple[float, ...]) -> tuple[float, ...]:
    if "matrix" in node:
        raise RuntimeError(f'GLB node {node.get("_pcrNodeIndex")} uses a matrix instead of TRS')
    value = node.get(key, defaults)
    if len(value) != len(defaults):
        raise RuntimeError(f'GLB node {node.get("_pcrNodeIndex")} has invalid {key}')
    return tuple(f32(item) for item in value)


def compare_local_transform(tree: dict, node: dict) -> dict:
    unity_position = transform_tuple(tree, "m_LocalPosition", ("x", "y", "z"), (0.0, 0.0, 0.0))
    unity_rotation = transform_tuple(tree, "m_LocalRotation", ("x", "y", "z", "w"), (0.0, 0.0, 0.0, 1.0))
    unity_scale = transform_tuple(tree, "m_LocalScale", ("x", "y", "z"), (1.0, 1.0, 1.0))
    expected_position = (f32(-unity_position[0]), unity_position[1], unity_position[2])
    expected_rotation = (
        unity_rotation[0], f32(-unity_rotation[1]), f32(-unity_rotation[2]), unity_rotation[3]
    )
    expected_scale = unity_scale
    actual_position = glb_transform_tuple(node, "translation", (0.0, 0.0, 0.0))
    actual_rotation = glb_transform_tuple(node, "rotation", (0.0, 0.0, 0.0, 1.0))
    actual_scale = glb_transform_tuple(node, "scale", (1.0, 1.0, 1.0))
    if sum(a * b for a, b in zip(expected_rotation, actual_rotation)) < 0.0:
        actual_rotation = tuple(f32(-value) for value in actual_rotation)
    canonical_zero = lambda value: 0.0 if value == 0.0 else value
    expected = tuple(canonical_zero(value) for value in (
        expected_position + expected_rotation + expected_scale
    ))
    actual = tuple(canonical_zero(value) for value in (
        actual_position + actual_rotation + actual_scale
    ))
    expected_bytes = struct.pack("<10f", *expected)
    actual_bytes = struct.pack("<10f", *actual)
    if expected_bytes != actual_bytes:
        max_error = max(abs(a - b) for a, b in zip(expected, actual))
        raise RuntimeError(
            f'GLB node {node.get("_pcrNodeIndex")}: local TRS differs from official conversion; max {max_error}'
        )
    return {
        "position": list(expected_position),
        "rotation": list(expected_rotation),
        "scale": list(expected_scale),
        "float32Sha256": sha256(expected_bytes),
    }


def expected_semantics(handler: MeshHandler) -> list[str]:
    result = []
    for semantic, (field, _) in SEMANTICS.items():
        if getattr(handler, field, None):
            result.append(semantic)
    return result


def primitive_submesh_groups(
    glb: Glb, primitives: list[dict], handler: MeshHandler
) -> list[list[int]]:
    triangles = handler.get_triangles()
    groups = []
    cursor = 0
    for primitive_index, primitive in enumerate(primitives):
        target = len(glb.accessor(int(primitive["indices"])))
        total = 0
        group = []
        while cursor < len(triangles) and total < target:
            count = len(triangles[cursor]) * 3
            total += count
            group.append(cursor)
            cursor += 1
        if total != target:
            raise RuntimeError(
                f"primitive {primitive_index}: cannot partition official submeshes "
                f"to index count {target}; reached {total}"
            )
        groups.append(group)
    if cursor != len(triangles):
        raise RuntimeError(
            f"GLB primitives consume {cursor} of {len(triangles)} official submeshes"
        )
    return groups


def primitive_payload(
    glb: Glb,
    primitive: dict,
    handler: MeshHandler,
    submesh_indices: int | list[int],
) -> tuple[list[int], list[int], dict[str, dict]]:
    if isinstance(submesh_indices, int):
        submesh_indices = [submesh_indices]
    triangle_sets = handler.get_triangles()
    official_indices = []
    for submesh_index in submesh_indices:
        submesh = handler.src.m_SubMeshes[submesh_index]
        base_vertex = int(submesh.baseVertex or 0)
        official_indices.extend(
            int(index) + base_vertex
            for triangle in triangle_sets[submesh_index]
            for index in reversed(triangle)
        )
    label = ",".join(str(index) for index in submesh_indices)
    glb_indices = [int(value[0]) for value in glb.accessor(int(primitive["indices"]))]
    if len(official_indices) != len(glb_indices):
        raise RuntimeError(
            f"submeshes {label}: index count {len(official_indices)} != {len(glb_indices)}"
        )
    official_semantics = expected_semantics(handler)
    glb_semantics = sorted(primitive.get("attributes", {}))
    if sorted(official_semantics) != glb_semantics:
        raise RuntimeError(
            f"submeshes {label}: attributes {sorted(official_semantics)} != {glb_semantics}"
        )
    payload = {}
    for semantic in official_semantics:
        field, dimension = SEMANTICS[semantic]
        source = getattr(handler, field)
        expected_by_vertex = [None] * len(glb.accessor(int(primitive["attributes"][semantic])))
        expected_expanded = []
        for official_index, glb_index in zip(official_indices, glb_indices):
            expected = canonical_components(semantic, tuple(source[official_index])[:dimension])
            previous = expected_by_vertex[glb_index]
            if previous is not None and previous != expected:
                raise RuntimeError(
                    f"submeshes {label} {semantic}: GLB vertex {glb_index} merges distinct official values"
                )
            expected_by_vertex[glb_index] = expected
            expected_expanded.append(expected)
        if any(value is None for value in expected_by_vertex):
            raise RuntimeError(f"submeshes {label} {semantic}: GLB has unreferenced vertices")
        glb_source = glb.accessor(int(primitive["attributes"][semantic]))
        glb_values = [tuple(f32(item) for item in glb_source[index]) for index in glb_indices]
        payload[semantic] = {
            "dimension": dimension,
            "expectedByVertex": expected_by_vertex,
            "expectedExpanded": expected_expanded,
            "glbExpanded": glb_values,
        }
    return official_indices, glb_indices, payload


def compare_primitive(
    glb: Glb,
    primitive: dict,
    handler: MeshHandler,
    submesh_indices: int | list[int],
) -> dict:
    official_indices, glb_indices, payload = primitive_payload(
        glb, primitive, handler, submesh_indices
    )
    if isinstance(submesh_indices, int):
        submesh_indices = [submesh_indices]
    triangle_count = sum(len(handler.get_triangles()[index]) for index in submesh_indices)
    label = ",".join(str(index) for index in submesh_indices)

    fields = {}
    aggregate_official = hashlib.sha256()
    aggregate_glb = hashlib.sha256()
    for semantic, values in payload.items():
        dimension = values["dimension"]
        official_values = values["expectedExpanded"]
        glb_values = values["glbExpanded"]
        official_bytes = packed_floats(official_values)
        glb_bytes = packed_floats(glb_values)
        if official_bytes != glb_bytes:
            mismatches = sum(a != b for a, b in zip(official_values, glb_values))
            max_error = max(
                abs(a - b)
                for left, right in zip(official_values, glb_values)
                for a, b in zip(left, right)
            )
            raise RuntimeError(
                f"submeshes {label} {semantic}: {mismatches} expanded vertices differ; max {max_error}"
            )
        aggregate_official.update(semantic.encode("ascii") + b"\0" + official_bytes)
        aggregate_glb.update(semantic.encode("ascii") + b"\0" + glb_bytes)
        fields[semantic] = {
            "components": dimension,
            "expandedVertexCount": len(official_values),
            "sha256": sha256(official_bytes),
        }

    if aggregate_official.digest() != aggregate_glb.digest():
        raise RuntimeError(f"submeshes {label}: aggregate payload differs")
    return {
        "submeshes": submesh_indices,
        "material": glb.material_name(primitive),
        "triangleCount": triangle_count,
        "indexCount": len(official_indices),
        "sourceVertexCount": int(handler.m_VertexCount),
        "glbVertexCount": len(glb.accessor(int(primitive["attributes"]["POSITION"]))),
        "attributes": fields,
        "expandedPayloadSha256": aggregate_official.hexdigest(),
    }


def extract(decrypted_root: Path) -> dict:
    prefabs = [MRT.prefab_bundle(decrypted_root, card) for card in CARDS]
    index = MRT.OfficialBundleIndex(decrypted_root)
    index.build(prefabs)
    decoded_meshes = {}
    cards = []
    all_payloads = hashlib.sha256()
    all_transforms = hashlib.sha256()
    total_filters = 0
    total_primitives = 0
    total_triangles = 0
    total_expanded_vertices = 0
    built_in_filters = 0
    material_slot_resolutions = {
        "exact-direct": 0,
        "exact-unique-material": 0,
        "runtime-required": 0,
    }

    for card, prefab in zip(CARDS, prefabs):
        glb_path = ROOT / "public" / "game" / "Assets" / "PrefabHierarchyObject" / f"{card}_L.glb"
        glb = Glb(glb_path)
        _, objects = index.load(prefab)
        mesh_filters = sorted(
            (obj for obj in objects.values() if obj.type.name == "MeshFilter"),
            key=lambda obj: int(obj.path_id),
        )
        renderers_by_game_object = {}
        for renderer in sorted(
            (obj for obj in objects.values() if obj.type.name == "MeshRenderer"),
            key=lambda obj: int(obj.path_id),
        ):
            key = game_object_key(renderer, objects)
            renderers_by_game_object.setdefault(key, []).append(renderer)
        rows = []
        card_built_in = 0
        matched_node_indices = set()
        for mesh_filter in mesh_filters:
            total_filters += 1
            node_path, transform_tree = game_object_path_and_transform(mesh_filter, objects)
            renderers = renderers_by_game_object.get(game_object_key(mesh_filter, objects), [])
            if len(renderers) != 1:
                raise RuntimeError(
                    f"{card}:{node_path}: MeshFilter has {len(renderers)} MeshRenderer siblings"
                )
            renderer = renderers[0]
            renderer_tree = renderer.read_typetree()
            material_identities = [
                pointer_identity(renderer, pointer)
                for pointer in (renderer_tree.get("m_Materials") or [])
            ]
            mesh_pointer = mesh_filter.read_typetree().get("m_Mesh") or {}
            try:
                mesh_obj, mesh_bundle, pointer = index.resolve(mesh_filter, prefab, mesh_pointer)
            except RuntimeError as error:
                if "unity default resources" not in str(error):
                    raise
                card_built_in += 1
                built_in_filters += 1
                continue
            if mesh_obj.type.name != "Mesh":
                raise RuntimeError(f"{node_path}: MeshFilter resolves to {mesh_obj.type.name}")
            identity = f"{index.relative(mesh_bundle)}:{int(mesh_obj.path_id)}"
            if identity not in decoded_meshes:
                mesh = mesh_obj.read()
                handler = MeshHandler(mesh)
                handler.process()
                decoded_meshes[identity] = (handler, {
                    "identity": identity,
                    "name": str(mesh.m_Name),
                    "bundle": index.relative(mesh_bundle),
                    "bundleSha256": index.bundle_hash(mesh_bundle),
                    "objectByteSize": len(mesh_obj.get_raw_data()),
                    "objectSha256": sha256(mesh_obj.get_raw_data()),
                })
            handler, source = decoded_meshes[identity]
            candidates = [
                node for node in glb.mesh_candidates(node_path)
                if int(node["_pcrNodeIndex"]) not in matched_node_indices
            ]
            primitive_rows = None
            selected_node = None
            candidate_errors = []
            for candidate in candidates:
                primitives = glb.node_primitives(candidate)
                trial_rows = []
                try:
                    groups = primitive_submesh_groups(glb, primitives, handler)
                    for primitive, group in zip(primitives, groups):
                        trial_rows.append(compare_primitive(glb, primitive, handler, group))
                except RuntimeError as error:
                    candidate_errors.append(f'node {candidate["_pcrNodeIndex"]}: {error}')
                    continue
                primitive_rows = trial_rows
                selected_node = candidate
                break
            if selected_node is None or primitive_rows is None:
                raise RuntimeError(
                    f"{card}:{node_path}: no GLB candidate has an exact payload: {candidate_errors}"
                )
            for row in primitive_rows:
                if not material_identities:
                    raise RuntimeError(f"{card}:{node_path}: MeshRenderer has no materials")
                resolutions = []
                for submesh_index in (int(index) for index in row["submeshes"]):
                    if submesh_index < len(material_identities):
                        material_slot = submesh_index
                        status = "exact-direct"
                    elif len(material_identities) == 1:
                        material_slot = 0
                        status = "exact-unique-material"
                    else:
                        material_slot = None
                        status = "runtime-required"
                    resolutions.append({
                        "submesh": submesh_index,
                        "status": status,
                        "materialSlot": material_slot,
                        "materialIdentity": (
                            material_identities[material_slot]
                            if material_slot is not None else None
                        ),
                    })
                    material_slot_resolutions[status] += 1
                row["materialSlotResolution"] = resolutions
            matched_node_indices.add(int(selected_node["_pcrNodeIndex"]))
            local_transform = compare_local_transform(transform_tree, selected_node)
            all_transforms.update(
                f"{card}\0{node_path}\0".encode("utf8")
                + bytes.fromhex(local_transform["float32Sha256"])
            )
            for primitive_index, row in enumerate(primitive_rows):
                total_primitives += 1
                total_triangles += row["triangleCount"]
                total_expanded_vertices += row["indexCount"]
                all_payloads.update(
                    f"{card}\0{node_path}\0{primitive_index}\0".encode("utf8")
                    + bytes.fromhex(row["expandedPayloadSha256"])
                )
            rows.append({
                "nodePath": node_path,
                "glbNodeIndex": int(selected_node["_pcrNodeIndex"]),
                "localTransform": local_transform,
                "mesh": source,
                "renderer": {
                    "identity": canonical_object_identity(renderer),
                    "materialIdentities": material_identities,
                },
                "primitives": primitive_rows,
            })
        glb_mesh_node_indices = {
            int(node["_pcrNodeIndex"])
            for nodes in glb.nodes_by_path.values()
            for node in nodes
            if "mesh" in node
        }
        if matched_node_indices != glb_mesh_node_indices:
            missing = sorted(glb_mesh_node_indices - matched_node_indices)
            extra = sorted(matched_node_indices - glb_mesh_node_indices)
            raise RuntimeError(f"{card}: GLB/official mesh-node set differs missing={missing} extra={extra}")
        cards.append({
            "card": card,
            "prefab": index.relative(prefab),
            "prefabSha256": index.bundle_hash(prefab),
            "glb": glb_path.relative_to(ROOT).as_posix(),
            "glbByteSize": len(glb.data),
            "glbSha256": sha256(glb.data),
            "meshFilterCount": len(mesh_filters),
            "builtInMeshFilterCount": card_built_in,
            "matchedMeshNodeCount": len(rows),
            "nodes": rows,
        })

    return {
        "schemaVersion": 2,
        "unityVersion": "2022.3.62f2",
        "scope": "four canonical L-prefabs and their AssetRipper GLBs",
        "conversion": {
            "position": "(-x, y, z)",
            "normal": "(-x, y, z)",
            "tangent": "(-x, y, z, -w)",
            "texcoord": "(u, 1-v)",
            "triangleWinding": "(a,b,c) -> (c,b,a)",
            "localPosition": "(-x, y, z)",
            "localRotation": "(x, -y, -z, w), accepting quaternion sign equivalence",
            "localScale": "(x, y, z)",
            "comparison": "ordered expanded float32 triangle streams",
        },
        "summary": {
            "cardCount": len(cards),
            "meshFilterCount": total_filters,
            "builtInMeshFilterCount": built_in_filters,
            "matchedMeshNodeCount": total_filters - built_in_filters,
            "distinctOfficialMeshCount": len(decoded_meshes),
            "primitiveCount": total_primitives,
            "triangleCount": total_triangles,
            "expandedVertexCount": total_expanded_vertices,
            "materialSlotResolutionCount": sum(material_slot_resolutions.values()),
            "exactDirectMaterialSlotCount": material_slot_resolutions["exact-direct"],
            "exactUniqueMaterialSlotCount": material_slot_resolutions["exact-unique-material"],
            "runtimeRequiredMaterialSlotCount": material_slot_resolutions["runtime-required"],
            "expandedPayloadAggregateSha256": all_payloads.hexdigest(),
            "localTransformAggregateSha256": all_transforms.hexdigest(),
        },
        "cards": cards,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED_ROOT)
    args = parser.parse_args()
    print(json.dumps(extract(args.decrypted_root.resolve()), ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
