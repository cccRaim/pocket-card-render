"""Rebuild flattened C1 stage inputs from selected Unity Vulkan programs."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import UnityPy
from extract_official_selector_program import one
from extract_official_material_program_inventory import (
    canonical_digest, object_map, resolve_static_executable, selector_witness_id,
    sha256_bytes, sha256_file, shader_program_segments, static_vulkan_candidates,
)
from smolv import find_and_decode_records

BUILD = Path(__file__).resolve().parent
PACKAGE = BUILD.parent / "public/programs/c1/shaders"


def flatten(source, recipe):
    if sha256_bytes(source.encode()) != recipe["crossSha256"]:
        raise ValueError("SPIRV-Cross output differs from the input of the WebGL port")
    source = re.sub(r"_\d+\._m\d+\b", lambda m: recipe["members"].get(m[0], m[0]), source)
    lines = source.splitlines(keepends=True)
    cursor = 0
    output = []
    for start, end, replacement in recipe["edits"]:
        if not cursor <= start <= end <= len(lines):
            raise ValueError("overlapping or out-of-range WebGL stage edit")
        output.extend(lines[cursor:start])
        output.append(replacement)
        cursor = end
    return "".join(output + lines[cursor:])


def rebuild(shader_root, work):
    recipes = json.loads((BUILD / "c1-stage-recipes.json").read_bytes())
    bundles = {sha256_file(p): p for p in shader_root.rglob("*") if p.is_file()}
    result = {}
    for name, route in recipes.items():
        manifest = json.loads((PACKAGE / name).read_bytes())
        selector = manifest["official_selector"]
        identity = selector["shaderIdentity"]
        cab, path_id = identity.split(":")
        bundle = UnityPy.load(str(bundles[route["bundleSha256"]]))
        obj = object_map(bundle)[cab, int(path_id)]
        raw_hash = sha256_bytes(obj.get_raw_data())
        if obj.type.name != "Shader" or raw_hash != route["shaderObjectSha256"]:
            raise ValueError(f"{name}: Shader object differs")
        shader = obj.read_typetree()
        candidates, unknown = static_vulkan_candidates(shader, tuple(selector["keywords"]))
        candidate = one(candidates, name)
        if (unknown or selector["selectionMode"] != "unique-exact-keywords"
                or selector["selectorId"] != canonical_digest([identity, selector["keywords"]])
                or selector["candidateWitnessId"] != selector_witness_id(identity, raw_hash, "exact-keywords", candidate)
                or (selector["subshader"], selector["pass"]) != (candidate["subshader"], candidate["pass"])):
            raise ValueError(f"{name}: serialized selector differs")
        executable = resolve_static_executable(shader, candidate)
        if (executable["identityFields"] != manifest["official_executable_identity"]
                or executable["semanticExecutableId"] != selector["semanticExecutableId"]):
            raise ValueError(f"{name}: executable or pass bindings differ")
        segment = one(shader_program_segments(shader), name)
        raw = segment["entries"][candidate["programBlobIndex"]]["raw"]
        modules = {sha256_bytes(m["decoded"]): m["decoded"] for m in find_and_decode_records(raw)}
        for stage, rule in route["stages"].items():
            spirv = work / "program.spv"
            spirv.write_bytes(modules[executable["identityFields"][stage + "SpirvSha256"]])
            subprocess.run([os.environ.get("SPIRV_VAL", "spirv-val"), str(spirv)], check=True)
            source = subprocess.check_output([
                os.environ.get("SPIRV_CROSS", "spirv-cross"), str(spirv), "--version", "300", "--es",
            ], text=True, encoding="utf-8")
            result.setdefault(name, {})[stage] = flatten(source, rule)
    return result


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        print(json.dumps(rebuild(Path(sys.argv[1]), Path(temp))))
