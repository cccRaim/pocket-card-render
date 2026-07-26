#!/usr/bin/env python3
"""Restore GLB vertex accessors from each card's official Unity Mesh payload."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import extract_official_mesh_payload as MESH


sys.dont_write_bytecode = True


def restore(decrypted_root: Path, check: bool) -> dict:
    prefabs = [MESH.MRT.prefab_bundle(decrypted_root, card) for card in MESH.CARDS]
    index = MESH.MRT.OfficialBundleIndex(decrypted_root)
    index.build(prefabs)
    decoded = {}
    changed_accessors = 0
    changed_components = 0
    matched_nodes = 0

    for card, prefab in zip(MESH.CARDS, prefabs):
        glb_path = MESH.ROOT / "public" / "game" / "Assets" / "PrefabHierarchyObject" / f"{card}_L.glb"
        glb = MESH.Glb(glb_path)
        _, objects = index.load(prefab)
        used_nodes = set()
        for mesh_filter in sorted(
            (obj for obj in objects.values() if obj.type.name == "MeshFilter"),
            key=lambda obj: int(obj.path_id),
        ):
            node_path, _ = MESH.game_object_path_and_transform(
                mesh_filter,
                objects,
            )
            try:
                mesh_obj, mesh_bundle, _ = index.resolve(
                    mesh_filter, prefab, mesh_filter.read_typetree().get("m_Mesh") or {}
                )
            except RuntimeError as error:
                if "unity default resources" in str(error):
                    continue
                raise
            identity = f"{index.relative(mesh_bundle)}:{int(mesh_obj.path_id)}"
            if identity not in decoded:
                handler = MESH.MeshHandler(mesh_obj.read())
                handler.process()
                decoded[identity] = handler
            handler = decoded[identity]
            selected = None
            selected_payloads = None
            errors = []
            for node in glb.mesh_candidates(node_path):
                node_index = int(node["_pcrNodeIndex"])
                if node_index in used_nodes:
                    continue
                primitives = glb.node_primitives(node)
                payloads = []
                try:
                    groups = MESH.primitive_submesh_groups(glb, primitives, handler)
                    for primitive, group in zip(primitives, groups):
                        _, _, payload = MESH.primitive_payload(
                            glb, primitive, handler, group
                        )
                        position = payload["POSITION"]
                        if MESH.packed_floats(position["expectedExpanded"]) != MESH.packed_floats(position["glbExpanded"]):
                            raise RuntimeError(f"submeshes {group}: POSITION does not identify this candidate")
                        payloads.append((primitive, payload))
                except RuntimeError as error:
                    errors.append(f"node {node_index}: {error}")
                    continue
                selected = node
                selected_payloads = payloads
                break
            if selected is None or selected_payloads is None:
                raise RuntimeError(f"{card}:{node_path}: no position-exact candidate: {errors}")
            used_nodes.add(int(selected["_pcrNodeIndex"]))
            matched_nodes += 1
            for primitive, payload in selected_payloads:
                for semantic, values in payload.items():
                    accessor_index = int(primitive["attributes"][semantic])
                    current = glb.accessor(accessor_index)
                    expected = values["expectedByVertex"]
                    for actual_value, expected_value in zip(current, expected):
                        changed_components += sum(
                            MESH.f32(actual) != target
                            for actual, target in zip(actual_value, expected_value)
                        )
                    if MESH.packed_floats([tuple(MESH.f32(item) for item in value) for value in current]) != MESH.packed_floats(expected):
                        changed_accessors += 1
                        if not check:
                            glb.write_accessor(accessor_index, expected)
        if not check:
            glb.save()
    return {
        "matchedNodes": matched_nodes,
        "changedAccessors": changed_accessors,
        "changedComponents": changed_components,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decrypted-root", type=Path, default=MESH.DEFAULT_DECRYPTED_ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = restore(args.decrypted_root.resolve(), args.check)
    mode = "check" if args.check else "restore"
    print(
        f"official mesh payload {mode}: {result['matchedNodes']} nodes, "
        f"{result['changedAccessors']} differing accessors, "
        f"{result['changedComponents']} differing float components"
    )
    if args.check and result["changedAccessors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
