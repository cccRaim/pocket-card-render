#!/usr/bin/env python3
"""Audit official vertex semantics through the local Three.js attribute adapter.

This audit deliberately keeps three facts separate:
1. ShaderSubProgram bind-channel bytes identify Unity mesh semantics.
2. The local WebGL port maps those semantics to Three r165 attribute names.
3. The official guest draw's actual vertex/default bindings require runtime evidence.

SPIR-V locations without a non-empty official bind-channel table are not promoted
to semantic exactness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from extract_official_material_program_inventory import DEFAULT_DECRYPTED_ROOT
from extract_official_selector_program import (
    DEFAULT_INVENTORY,
    SelectorProgramExtractionSession,
)


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "public" / "shaders" / "official_program_port_contract.json"
SCHEMA = "pocket-card-render/official-vertex-input-audit@1"
THREE_VERSION = "0.165.0"
THREE_FILES = {
    "gltfLoader": (
        ROOT / "node_modules" / "three" / "examples" / "jsm" / "loaders" / "GLTFLoader.js",
        "32e8ea1535e3016302dec82371beccd60e9cd371ee09fd8daee2ac45e8148a56",
    ),
    "shaderMaterial": (
        ROOT / "node_modules" / "three" / "src" / "materials" / "ShaderMaterial.js",
        "4444dac67380bbe2c5ce73e659f5e7b2b24543bfb55be20e404d84dca01313ef",
    ),
    "rawShaderMaterial": (
        ROOT / "node_modules" / "three" / "src" / "materials" / "RawShaderMaterial.js",
        "fec795b396ef86ac5f80334ecb9a16bf3ca7feaec55f710de5d570afffa7ceae",
    ),
    "webglBindingStates": (
        ROOT / "node_modules" / "three" / "src" / "renderers" / "webgl" / "WebGLBindingStates.js",
        "4545d5cca0fd43d77a41a73eda63f8312cc753f446831e7f981286edba8bda17",
    ),
}
THREE_ATTRIBUTE_BY_SOURCE = {
    "Vertex": ("position", "vec3"),
    "Normal": ("normal", "vec3"),
    "Tangent": ("tangent", "vec4"),
    "Color": ("color", "vec4"),
    "UV0": ("uv", "vec2"),
    "UV1": ("uv1", "vec2"),
    "UV2": ("uv2", "vec2"),
    "UV3": ("uv3", "vec2"),
    "UV4": ("uv4", "vec2"),
    "UV5": ("uv5", "vec2"),
    "UV6": ("uv6", "vec2"),
    "UV7": ("uv7", "vec2"),
    "SkinWeight": ("skinWeight", "vec4"),
    "SkinBoneIndex": ("skinIndex", "uvec4"),
}
GLSL_INPUT_RE = re.compile(
    r"^\s*(?:layout\s*\([^)]*\)\s*)?in\s+"
    r"(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*;\s*$",
    re.MULTILINE,
)


def fail(message: str) -> None:
    raise RuntimeError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        fail(f"{label} keys changed: {sorted(actual)} != {sorted(expected)}")


def three_contract() -> dict:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    version = ((lock.get("packages") or {}).get("node_modules/three") or {}).get("version")
    if version != THREE_VERSION:
        fail(f"Three lock version changed: {version} != {THREE_VERSION}")
    hashes = {}
    for name, (path, expected) in THREE_FILES.items():
        actual = sha256_file(path)
        if actual != expected:
            fail(f"Three r165 proof source changed: {path} {actual} != {expected}")
        hashes[name] = actual

    gltf = THREE_FILES["gltfLoader"][0].read_text(encoding="utf-8")
    shader_material = THREE_FILES["shaderMaterial"][0].read_text(encoding="utf-8")
    raw_material = THREE_FILES["rawShaderMaterial"][0].read_text(encoding="utf-8")
    binding_states = THREE_FILES["webglBindingStates"][0].read_text(encoding="utf-8")
    required = {
        "TEXCOORD_1: 'uv1'": gltf,
        "COLOR_0: 'color'": gltf,
        "'color': [ 1, 1, 1 ]": shader_material,
        "'uv1': [ 0, 0 ]": shader_material,
        "class RawShaderMaterial extends ShaderMaterial": raw_material,
        "gl.vertexAttrib2fv( programAttribute.location, value )": binding_states,
        "gl.vertexAttrib4fv( programAttribute.location, value )": binding_states,
    }
    missing = sorted(snippet for snippet, source in required.items() if snippet not in source)
    if missing:
        fail(f"Three r165 attribute behavior changed: {missing}")
    return {
        "status": "exact-local-backend",
        "version": version,
        "sourceSha256": hashes,
        "gltfSemanticMap": {"TEXCOORD_1": "uv1", "COLOR_0": "color"},
        "missingAttributeDefaults": {"uv1": [0, 0], "color": [1, 1, 1]},
        "officialGuestEquivalence": "runtime-required",
    }


def reflected_inputs(vertex_spirv: Path, spirv_cross: str) -> list[dict]:
    process = subprocess.run(
        [spirv_cross, str(vertex_spirv), "--reflect"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        fail(f"SPIRV-Cross reflection failed: {process.stderr or process.stdout}")
    value = json.loads(process.stdout)
    rows = []
    for raw in value.get("inputs") or []:
        rows.append({
            "location": int(raw["location"]),
            "spirvName": str(raw["name"]),
            "spirvType": str(raw["type"]),
        })
    rows.sort(key=lambda row: row["location"])
    if len({row["location"] for row in rows}) != len(rows):
        fail("SPIR-V vertex input locations are not unique")
    return rows


def join_official_semantics(bind_contract: dict, reflection: list[dict]) -> dict:
    channels = bind_contract.get("bindChannels") or []
    by_location = {row["location"]: row for row in reflection}
    if not channels:
        return {
            "status": "runtime-required" if reflection else "exact-no-inputs",
            "reason": "official program entry has no bind-channel semantics" if reflection else None,
            "inputs": [],
            "unresolvedSpirvInputs": reflection,
        }

    joined = []
    used = set()
    for index, channel in enumerate(channels):
        target = int(channel["target"])
        if target < 13 or target > 28:
            fail(f"bind channel {index} is not a Vulkan generic attribute: {target}")
        expected_target_name = f"Attrib{target - 12}"
        if channel.get("targetName") != expected_target_name:
            fail(f"bind channel {index} target name changed")
        location = target - 13
        reflected = by_location.get(location)
        if reflected is None:
            fail(f"bind channel {index} has no SPIR-V input at location {location}")
        if location in used:
            fail(f"bind channel location {location} is duplicated")
        used.add(location)
        source_name = str(channel["sourceName"])
        if source_name not in THREE_ATTRIBUTE_BY_SOURCE:
            fail(f"unsupported official ShaderChannel semantic: {source_name}")
        three_name, three_type = THREE_ATTRIBUTE_BY_SOURCE[source_name]
        joined.append({
            "source": int(channel["source"]),
            "sourceName": source_name,
            "target": target,
            "targetName": expected_target_name,
            "location": location,
            "threeAttribute": three_name,
            "threeAttributeType": three_type,
            **reflected,
        })
    unresolved = [row for row in reflection if row["location"] not in used]
    if unresolved:
        fail(f"SPIR-V inputs are absent from official bind channels: {unresolved}")
    return {"status": "exact", "reason": None, "inputs": joined, "unresolvedSpirvInputs": []}


def glsl_inputs(path: Path) -> dict[str, str]:
    source = path.read_text(encoding="utf-8")
    rows = GLSL_INPUT_RE.findall(source)
    result = {}
    for value_type, name in rows:
        if name in result:
            fail(f"duplicate adapted GLSL input {name}: {path}")
        result[name] = value_type
    return result


def audit_port(port: dict, metadata: dict, vertex_spirv: Path, spirv_cross: str) -> dict:
    manifest_path = ROOT / str(port["manifest"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selector = manifest.get("official_selector") or {}
    for key in ("selectorId", "candidateWitnessId", "subshader", "pass"):
        if selector.get(key) != port.get(key):
            fail(f"{port['manifest']}: official selector {key} changed")

    reflection = reflected_inputs(vertex_spirv, spirv_cross)
    semantics = join_official_semantics(metadata["programBindChannels"], reflection)
    runtime = manifest.get("runtime_contract") or {}
    runtime_attributes = runtime.get("attributes")
    if runtime_attributes is not None and not isinstance(runtime_attributes, dict):
        fail(f"{port['manifest']}: runtime_contract.attributes is not an object")
    vertex_source = (manifest.get("webgl_sources") or {}).get("vertex")
    if not isinstance(vertex_source, str) or not vertex_source:
        manifest_name = Path(str(port["manifest"])).name
        if not manifest_name.endswith("_uniforms.json"):
            fail(f"{port['manifest']}: webgl vertex source is absent")
        vertex_source = "public/shaders/" + manifest_name.removesuffix("_uniforms.json") + ".vert.glsl"
        if not (ROOT / vertex_source).is_file():
            fail(f"{port['manifest']}: conventional webgl vertex source is absent")
    declarations = glsl_inputs(ROOT / vertex_source)
    if runtime_attributes is not None and declarations != runtime_attributes:
        fail(
            f"{port['manifest']}: runtime attributes differ from adapted GLSL inputs: "
            f"{runtime_attributes} != {declarations}"
        )
    attributes = declarations

    if semantics["status"] == "exact":
        expected = {
            row["threeAttribute"]: row["threeAttributeType"]
            for row in semantics["inputs"]
        }
        if attributes != expected:
            fail(
                f"{port['manifest']}: official semantic adapter changed: "
                f"{attributes} != {expected}"
            )
        adapter_status = "exact"
    elif semantics["status"] == "exact-no-inputs":
        if attributes:
            fail(f"{port['manifest']}: local attributes exist for an official no-input program")
        adapter_status = "exact"
    else:
        if len(attributes) != len(reflection):
            fail(
                f"{port['manifest']}: local attribute count differs from unresolved SPIR-V inputs"
            )
        adapter_status = "inferred"

    return {
        "selectorId": port["selectorId"],
        "candidateWitnessId": port["candidateWitnessId"],
        "subshader": port["subshader"],
        "pass": port["pass"],
        "manifest": port["manifest"],
        "semanticProof": semantics,
        "localAdapter": {
            "status": adapter_status,
            "attributes": attributes,
            "vertexSource": vertex_source,
            "vertexSourceSha256": sha256_file(ROOT / vertex_source),
        },
        "officialGuestVertexBinding": {
            "status": "runtime-required" if reflection else "not-applicable",
            "reason": "static Shader/Mesh data cannot prove the guest draw's bound vertex/default values" if reflection else None,
        },
    }


def run_audit(spirv_cross: str) -> dict:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    inventory = json.loads(DEFAULT_INVENTORY.read_text(encoding="utf-8-sig"))
    proof_hash = inventory["digests"]["proofGraphSha256"]
    port_hash = inventory["digests"]["portIndexSha256"]
    if contract["inventory"]["proofGraphSha256"] != proof_hash:
        fail("program-port contract proof graph changed")
    if contract["inventory"]["portIndexSha256"] != port_hash:
        fail("program-port contract port index changed")

    session = SelectorProgramExtractionSession(
        inventory_path=DEFAULT_INVENTORY,
        decrypted_root=Path(DEFAULT_DECRYPTED_ROOT).resolve(),
        expected_proof_graph_sha256=proof_hash,
        expected_port_index_sha256=port_hash,
    )
    rows = []
    errors = []
    with tempfile.TemporaryDirectory(prefix="pcr-vertex-input-audit-") as temporary:
        out = Path(temporary)
        for index, port in enumerate(contract["ports"]):
            prefix = f"port_{index}"
            metadata = session.extract(
                selector_id=port["selectorId"],
                candidate_witness_id=port["candidateWitnessId"],
                subshader=port["subshader"],
                pass_index=port["pass"],
                out=out,
                prefix=prefix,
            )
            vertex = out / metadata["artifacts"]["vertex"]["path"]
            try:
                rows.append(audit_port(port, metadata, vertex, spirv_cross))
            except RuntimeError as error:
                errors.append(f"{port['manifest']}: {error}")

    if errors:
        fail("vertex input contract failures:\n  " + "\n  ".join(errors))

    exact_semantics = sum(row["semanticProof"]["status"].startswith("exact") for row in rows)
    exact_adapters = sum(row["localAdapter"]["status"] == "exact" for row in rows)
    return {
        "schema": SCHEMA,
        "inventory": {
            "proofGraphSha256": proof_hash,
            "portIndexSha256": port_hash,
        },
        "threeBackend": three_contract(),
        "summary": {
            "portCount": len(rows),
            "officialSemanticExactPorts": exact_semantics,
            "officialSemanticRuntimeRequiredPorts": len(rows) - exact_semantics,
            "localAdapterExactPorts": exact_adapters,
            "localAdapterInferredPorts": len(rows) - exact_adapters,
            "officialGuestVertexBindingExactPorts": 0,
            "officialGuestVertexBindingRuntimeRequiredPorts": sum(
                row["officialGuestVertexBinding"]["status"] == "runtime-required"
                for row in rows
            ),
        },
        "rows": rows,
        "sessionStatistics": session.statistics,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--spirv-cross", default="spirv-cross")
    args = parser.parse_args()
    report = run_audit(args.spirv_cross)
    if args.json:
        print(json.dumps(report, ensure_ascii=True, separators=(",", ":")))
        return
    summary = report["summary"]
    print(
        "Official vertex inputs: "
        f"semantic exact {summary['officialSemanticExactPorts']}/{summary['portCount']}, "
        f"local adapter exact {summary['localAdapterExactPorts']}/{summary['portCount']}, "
        "guest binding exact 0/"
        f"{summary['officialGuestVertexBindingRuntimeRequiredPorts']}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BAD official vertex-input audit: {error}")
        raise SystemExit(1)
