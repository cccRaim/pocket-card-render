#!/usr/bin/env python3
"""Join official Mesh payloads to selector vertex-input contracts.

The report proves static source/channel availability for canonical card draws.
It deliberately does not promote the guest's submitted VkVertexInput state or
missing-channel default values without native runtime evidence.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))

import audit_official_vertex_inputs as VERTEX  # noqa: E402
import extract_official_mesh_payload as MESH  # noqa: E402


SCHEMA = "pocket-card-render/official-mesh-vertex-bindings@1"
INVENTORY = ROOT / "$cache" / "official-material-program-inventory-v4-full.json"
CONTRACT = ROOT / "public" / "shaders" / "official_program_port_contract.json"
SOURCE_TO_GLB = {
    "Vertex": "POSITION",
    "Normal": "NORMAL",
    "Tangent": "TANGENT",
    "Color": "COLOR_0",
    "UV0": "TEXCOORD_0",
    "UV1": "TEXCOORD_1",
    "UV2": "TEXCOORD_2",
    "UV3": "TEXCOORD_3",
    "UV4": "TEXCOORD_4",
    "UV5": "TEXCOORD_5",
    "UV6": "TEXCOORD_6",
    "UV7": "TEXCOORD_7",
}
THREE_DEFAULTS = {
    "color": [1, 1, 1],
    "uv1": [0, 0],
}


def fail(message: str) -> None:
    raise RuntimeError(message)


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def material_selector(material: dict) -> str:
    return canonical_digest([material["shaderIdentity"], material["keywords"]])


def classify_required_inputs(required: list[dict], attributes: dict) -> dict:
    present = []
    missing = []
    for row in required:
        source = str(row["sourceName"])
        semantic = SOURCE_TO_GLB.get(source)
        if semantic is None:
            fail(f"unsupported Mesh semantic in selector contract: {source}")
        item = {
            "sourceName": source,
            "glbSemantic": semantic,
            "threeAttribute": row["threeAttribute"],
            "location": int(row["location"]),
        }
        if semantic in attributes:
            payload = attributes[semantic]
            item["components"] = int(payload["components"])
            item["expandedPayloadSha256"] = str(payload["sha256"])
            present.append(item)
        else:
            default = THREE_DEFAULTS.get(str(row["threeAttribute"]))
            item["localThreeDefault"] = default
            item["officialGuestDefault"] = "runtime-required"
            missing.append(item)
    return {
        "status": "exact-all-present" if not missing else "exact-static-with-missing-channels",
        "present": present,
        "missing": missing,
    }


def inventory_maps(inventory: dict) -> tuple[dict, dict]:
    graph = inventory.get("proofGraph") or {}
    materials = {row["identity"]: row for row in graph.get("materials") or []}
    usage = {}
    for row in graph.get("usageRows") or []:
        key = (
            str(row["illustrationId"]),
            str(row["rendererIdentity"]),
            int(row["materialSlot"]),
        )
        if key in usage:
            fail(f"duplicate official material-slot usage: {key}")
        usage[key] = str(row["materialIdentity"])
    return materials, usage


def collect_guest_default_obligations(rows: list[dict]) -> list[dict]:
    grouped = defaultdict(dict)
    for row in rows:
        for item in row["channelProof"]["missing"]:
            key = (
                row["selectorId"],
                item["sourceName"],
                row["meshIdentity"],
            )
            draw = {
                "illustrationId": row["illustrationId"],
                "rendererIdentity": row["rendererIdentity"],
                "nodePath": row["nodePath"],
                "materialSlot": row["materialSlot"],
                "materialIdentity": row["materialIdentity"],
                "candidateWitnessId": row["candidateWitnessId"],
                "subshader": row["subshader"],
                "pass": row["pass"],
                "manifest": row["manifest"],
                "threeAttribute": item["threeAttribute"],
                "localThreeDefault": item["localThreeDefault"],
            }
            grouped[key][canonical_digest(draw)] = draw
    return [
        {
            "selectorId": selector,
            "sourceName": source,
            "meshIdentity": mesh_identity,
            "officialGuestDefault": "runtime-required",
            "affectedDraws": [draws[digest] for digest in sorted(draws)],
        }
        for (selector, source, mesh_identity), draws in sorted(grouped.items())
    ]


def run_audit(
    spirv_cross: str = "spirv-cross",
    *,
    inventory_path: Path = INVENTORY,
    contract_path: Path = CONTRACT,
    port_root: Path | None = None,
    decrypted_root: Path = MESH.DEFAULT_DECRYPTED_ROOT,
    unity_version: str | None = None,
) -> dict:
    inventory_path = Path(inventory_path).resolve()
    contract_path = Path(contract_path).resolve()
    decrypted_root = Path(decrypted_root).resolve()
    port_root = Path(port_root).resolve() if port_root is not None else None
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    selected_unity_version = unity_version or str(inventory.get("unityVersion", ""))
    if not selected_unity_version:
        fail("inventory has no Unity version")
    if inventory["digests"]["proofGraphSha256"] != contract["inventory"]["proofGraphSha256"]:
        fail("mesh binding audit inventory proof graph changed")
    if inventory["digests"]["portIndexSha256"] != contract["inventory"]["portIndexSha256"]:
        fail("mesh binding audit port index changed")

    materials, usage = inventory_maps(inventory)
    ports_by_selector = defaultdict(list)
    for port in contract["ports"]:
        ports_by_selector[str(port["selectorId"])].append(port)

    vertex = VERTEX.run_audit(
        spirv_cross,
        inventory_path=inventory_path,
        decrypted_root=decrypted_root,
        contract_path=contract_path,
        port_root=port_root,
        unity_version=selected_unity_version,
    )
    vertex_by_port = {}
    for row in vertex["rows"]:
        key = (
            str(row["selectorId"]),
            str(row["candidateWitnessId"]),
            int(row["subshader"]),
            int(row["pass"]),
        )
        if key in vertex_by_port:
            fail(f"duplicate vertex-input port row: {key}")
        vertex_by_port[key] = row

    mesh = MESH.extract(decrypted_root, selected_unity_version)
    rows = []
    ignored_slots = Counter()
    resolution_counts = Counter()
    joined_usage_keys = set()
    for card in mesh["cards"]:
        illustration_id = str(card["card"])
        for node in card["nodes"]:
            renderer = node["renderer"]
            for primitive_index, primitive in enumerate(node["primitives"]):
                for resolution in primitive["materialSlotResolution"]:
                    resolution_counts[str(resolution["status"])] += 1
                    slot = resolution.get("materialSlot")
                    if slot is None:
                        fail(
                            f"{illustration_id}:{node['nodePath']}: material slot remains runtime-required"
                        )
                    usage_key = (illustration_id, str(renderer["identity"]), int(slot))
                    inventory_material = usage.get(usage_key)
                    if inventory_material is None:
                        fail(f"canonical mesh draw is absent from official usage inventory: {usage_key}")
                    if inventory_material != resolution["materialIdentity"]:
                        fail(
                            f"canonical mesh material differs from inventory: {usage_key} "
                            f"{resolution['materialIdentity']} != {inventory_material}"
                        )
                    joined_usage_keys.add(usage_key)
                    material = materials.get(inventory_material)
                    if material is None:
                        fail(f"official material is absent from inventory: {inventory_material}")
                    selector_id = material_selector(material)
                    ports = ports_by_selector.get(selector_id) or []
                    if not ports:
                        ignored_slots[selector_id] += 1
                        continue
                    for port in ports:
                        port_key = (
                            selector_id,
                            str(port["candidateWitnessId"]),
                            int(port["subshader"]),
                            int(port["pass"]),
                        )
                        vertex_row = vertex_by_port.get(port_key)
                        if vertex_row is None:
                            fail(f"selector port has no vertex-input proof: {port_key}")
                        semantic_proof = vertex_row["semanticProof"]
                        if semantic_proof["status"] != "exact":
                            fail(f"canonical selector has unresolved semantic proof: {port_key}")
                        classification = classify_required_inputs(
                            semantic_proof["inputs"], primitive["attributes"]
                        )
                        rows.append({
                            "illustrationId": illustration_id,
                            "rendererIdentity": renderer["identity"],
                            "nodePath": node["nodePath"],
                            "glbNodeIndex": node["glbNodeIndex"],
                            "primitiveIndex": primitive_index,
                            "submesh": int(resolution["submesh"]),
                            "materialSlot": int(slot),
                            "materialSlotResolution": resolution["status"],
                            "materialIdentity": inventory_material,
                            "selectorId": selector_id,
                            "candidateWitnessId": port["candidateWitnessId"],
                            "subshader": port["subshader"],
                            "pass": port["pass"],
                            "manifest": port["manifest"],
                            "meshIdentity": node["mesh"]["identity"],
                            "meshObjectSha256": node["mesh"]["objectSha256"],
                            "primitivePayloadSha256": primitive["expandedPayloadSha256"],
                            "channelProof": classification,
                            "officialGuestVertexBinding": "runtime-required",
                        })

    present = sum(len(row["channelProof"]["present"]) for row in rows)
    missing = sum(len(row["channelProof"]["missing"]) for row in rows)
    default_obligations = collect_guest_default_obligations(rows)
    return {
        "schema": SCHEMA,
        "unityVersion": selected_unity_version,
        "contract": {
            "path": contract_path.as_posix(),
            "sha256": MESH.sha256_file(contract_path),
        },
        "inventory": {
            "proofGraphSha256": inventory["digests"]["proofGraphSha256"],
            "portIndexSha256": inventory["digests"]["portIndexSha256"],
            "usageRowsSha256": inventory["digests"]["usageRowsSha256"],
        },
        "meshPayload": {
            "expandedPayloadAggregateSha256": mesh["summary"]["expandedPayloadAggregateSha256"],
            "localTransformAggregateSha256": mesh["summary"]["localTransformAggregateSha256"],
        },
        "summary": {
            "canonicalCardCount": len(mesh["cards"]),
            "canonicalMaterialSlotResolutions": sum(resolution_counts.values()),
            "exactDirectMaterialSlots": resolution_counts["exact-direct"],
            "exactUniqueMaterialSlots": resolution_counts["exact-unique-material"],
            "runtimeRequiredMaterialSlots": resolution_counts["runtime-required"],
            "joinedInventoryUsageKeys": len(joined_usage_keys),
            "exactPortDrawPassRows": len(rows),
            "requiredChannelBindings": present + missing,
            "presentChannelBindings": present,
            "missingChannelBindings": missing,
            "guestDefaultBindingObligations": len(default_obligations),
            "officialGuestVertexBindingExactRows": 0,
            "officialGuestVertexBindingRuntimeRequiredRows": len(rows),
            "nonPortSelectorSlotResolutions": sum(ignored_slots.values()),
        },
        "guestDefaultBindingObligations": default_obligations,
        "rows": rows,
        "upstreamVertexInputSummary": vertex["summary"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--spirv-cross", default="spirv-cross")
    parser.add_argument("--inventory", type=Path, default=INVENTORY)
    parser.add_argument("--contract", type=Path, default=CONTRACT)
    parser.add_argument("--port-root", type=Path)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=MESH.DEFAULT_DECRYPTED_ROOT,
    )
    parser.add_argument("--unity-version")
    args = parser.parse_args()
    report = run_audit(
        args.spirv_cross,
        inventory_path=args.inventory,
        contract_path=args.contract,
        port_root=args.port_root,
        decrypted_root=args.decrypted_root,
        unity_version=args.unity_version,
    )
    if args.json:
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return
    summary = report["summary"]
    print(
        "Official Mesh vertex bindings: "
        f"{summary['presentChannelBindings']}/{summary['requiredChannelBindings']} present, "
        f"{summary['missingChannelBindings']} missing, "
        f"{summary['guestDefaultBindingObligations']} guest-default obligations"
    )
    print(
        f"  {summary['exactPortDrawPassRows']} canonical exact-port draw/pass rows; "
        f"guest binding exact 0/{summary['officialGuestVertexBindingRuntimeRequiredRows']}"
    )


if __name__ == "__main__":
    main()
